"""
AgentProbe API Router: Fully typed, versioned REST endpoints.
Handles runs, matrix jobs, shrinker, auto-hardening, diagnoses, predictor, exports, and history.
"""
import asyncio
import datetime
import json
import logging
import os
import uuid
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Response, status
from pydantic import BaseModel, Field

from app.db import MatrixJobRecord, db_manager
from app.diagnosis import DiagnosisEngine
from app.env import SCENARIOS
from app.hardening import run_hardening_loop
from app.llm import load_cassettes
from app.predictor import predictor_engine
from app.report import generate_finetune_jsonl, generate_markdown_report
from app.runner import run_experiment
from app.schemas import (
    AggregateMetrics,
    Diagnosis,
    HardeningResult,
    MinimalFaultSet,
    PolicyConfig,
    PredictorPredictRequest,
    PredictorPredictResponse,
    PredictorTrainResponse,
    RunCreateRequest,
    RunResponse,
    ScenarioSpec,
)
from app.shrinker import run_shrinker
from app.grader import DeterministicGrader


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["AgentProbe API"])


class MatrixJobRequest(BaseModel):
    scenarios: List[str] = Field(
        default=["healthy_service", "bad_deploy", "rollback_denied", "unfixable_rollback", "injected_instruction"]
    )
    agents: List[str] = Field(default=["naive", "robust", "llm"])
    fault_types: List[str] = Field(
        default=["none", "timeout", "http_500", "malformed_json", "empty_response", "transient_then_success"]
    )
    intensity: int = Field(default=1, ge=0, le=5)
    seed: int = Field(default=42)
    seed_count: int = Field(default=10, ge=1, le=20)
    seeds: Optional[List[int]] = None


class MatrixJobStatusResponse(BaseModel):
    job_id: str
    status: str
    total_runs: int
    completed_runs: int
    created_at: str
    completed_at: Optional[str] = None
    heatmap: Optional[Dict[str, Dict[str, Optional[float]]]] = None
    heatmap_details: Optional[Dict[str, Dict[str, Any]]] = None
    summary: Optional[Dict[str, Any]] = None


@router.get("/health")
def get_health():
    """Healthcheck endpoint for orchestrator and compose."""
    return {
        "status": "ok",
        "service": "AgentProbe API",
        "version": "1.0.0",
        "db": "healthy",
        "llm_mode": os.getenv("LLM_MODE", "replay"),
    }


@router.get("/scenarios", response_model=List[ScenarioSpec])
def list_scenarios():
    """List all 5 ops scenarios with configurations and expectations."""
    return list(SCENARIOS.values())


@router.get("/cassettes")
def list_cassettes():
    """List available LLM cassettes with honest provenance labeling."""
    cassettes = load_cassettes()
    unique = {}
    for k, v in cassettes.items():
        unique[v.cassette_id] = v.model_dump()
    return list(unique.values())


@router.post("/runs", response_model=RunResponse)
def create_run(req: RunCreateRequest):
    """Execute a single deterministic experiment and persist results."""
    try:
        run_res = run_experiment(req)
        db_manager.save_run(run_res)
        return run_res
    except Exception as e:
        logger.error(f"Error executing run: {e}", exc_info=True)
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/runs", response_model=List[RunResponse])
def list_runs(limit: int = Query(default=50, ge=1, le=500), offset: int = Query(default=0, ge=0)):
    """List stored runs with pagination."""
    return db_manager.list_runs(limit=limit, offset=offset)


@router.get("/runs/{run_id}", response_model=RunResponse)
def get_run(run_id: str):
    """Fetch detail for a single run by ID."""
    run = db_manager.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")
    return run


def ensure_coverage_runs():
    """
    Ensures that the reliability matrix has coverage across empty_response and
    offline replay cassette runs for llm across fault types.
    """
    runs = db_manager.list_all_runs()
    scenarios = ["healthy_service", "bad_deploy", "rollback_denied", "unfixable_rollback", "injected_instruction"]
    all_faults = ["none", "timeout", "http_500", "malformed_json", "empty_response", "transient_then_success"]

    # Seed empty_response if missing or under-represented (< 6 runs)
    empty_runs = [r for r in runs if r.fault_schedule and r.fault_schedule[0].type == "empty_response"]
    if len(empty_runs) < 6:
        for scen in scenarios:
            for ag in ["naive", "robust"]:
                try:
                    res = run_experiment(RunCreateRequest(
                        scenario_id=scen,
                        agent_type=ag,
                        fault_type="empty_response",
                        fault_intensity=1,
                        seed=42,
                    ))
                    db_manager.save_run(res)
                except Exception as e:
                    logger.warning(f"Failed to seed empty_response run: {e}")

    # Seed llm replay runs if fewer than 10
    llm_runs = [r for r in runs if DeterministicGrader.normalize_agent_name(r.agent_type) == "llm"]
    if len(llm_runs) < 10:
        for scen in scenarios:
            for ft in all_faults:
                try:
                    res = run_experiment(RunCreateRequest(
                        scenario_id=scen,
                        agent_type="llm",
                        fault_type=None if ft == "none" else ft,
                        fault_intensity=0 if ft == "none" else 1,
                        seed=42,
                    ))
                    db_manager.save_run(res)
                except Exception as e:
                    logger.warning(f"Failed to seed llm replay run: {e}")


@router.get("/metrics")
def get_metrics():
    """Calculate aggregate KPIs and reliability matrix heatmap across stored runs."""
    ensure_coverage_runs()
    runs = db_manager.list_all_runs()
    analysis = DeterministicGrader.compute_dataset_analysis([r.model_dump() for r in runs])
    return {
        "aggregates": analysis["aggregates"],
        "reliability_matrix": analysis["matrix"],
        "reliability_matrix_details": analysis["matrix_details"],
        "baseline_vs_faulted": analysis["baseline_vs_faulted"],
    }


def _execute_matrix_job(job_id: str, req: MatrixJobRequest):
    """Worker task executing matrix experiments synchronously."""
    from app.stats import format_rate_with_n, wilson_score_interval
    try:
        job = db_manager.get_matrix_job(job_id)
        if not job:
            return

        active_seeds = req.seeds if (req.seeds and len(req.seeds) > 0) else [req.seed + i for i in range(req.seed_count)]
        total_runs = len(req.scenarios) * len(req.agents) * len(req.fault_types) * len(active_seeds)
        executed_runs: List[RunResponse] = []

        for scen in req.scenarios:
            for ag in req.agents:
                for ft in req.fault_types:
                    for seed_val in active_seeds:
                        f_intensity = 0 if ft == "none" else req.intensity
                        run_req = RunCreateRequest(
                            scenario_id=scen,
                            agent_type=ag,
                            fault_type=None if ft == "none" else ft,
                            fault_intensity=f_intensity,
                            seed=seed_val,
                        )
                        res = run_experiment(run_req)
                        db_manager.save_run(res)
                        executed_runs.append(res)

        analysis = DeterministicGrader.compute_dataset_analysis([r.model_dump() for r in executed_runs])

        job.status = "completed"
        job.completed_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
        job.results_json = json.dumps({
            "total_runs": total_runs,
            "completed_runs": len(executed_runs),
            "heatmap": analysis["matrix"],
            "heatmap_details": analysis["matrix_details"],
            "baseline_vs_faulted": analysis["baseline_vs_faulted"],
            "aggregates": analysis["aggregates"],
        })
        db_manager.save_matrix_job(job)
    except Exception as e:
        logger.error(f"Matrix job {job_id} failed: {e}", exc_info=True)
        job = db_manager.get_matrix_job(job_id)
        if job:
            job.status = "failed"
            db_manager.save_matrix_job(job)


@router.post("/matrix")
def start_matrix_job(req: MatrixJobRequest, background_tasks: BackgroundTasks):
    """Start an evaluation matrix across policies, scenarios, and fault types."""
    job_id = f"job_{uuid.uuid4().hex[:10]}"
    job_record = MatrixJobRecord(
        id=job_id,
        status="running",
        config_json=json.dumps(req.model_dump()),
        created_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
    )
    db_manager.save_matrix_job(job_record)
    background_tasks.add_task(_execute_matrix_job, job_id, req)

    active_seeds = req.seeds if (req.seeds and len(req.seeds) > 0) else [req.seed + i for i in range(req.seed_count)]
    total_runs = len(req.scenarios) * len(req.agents) * len(req.fault_types) * len(active_seeds)
    return {
        "job_id": job_id,
        "status": "running",
        "total_runs": total_runs,
        "message": f"Matrix evaluation started in background across {len(active_seeds)} seeds per cell",
    }


@router.get("/matrix/{job_id}", response_model=MatrixJobStatusResponse)
def get_matrix_job(job_id: str):
    """Poll status of a matrix evaluation job."""
    job = db_manager.get_matrix_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Matrix job '{job_id}' not found")

    cfg = json.loads(job.config_json)
    total_runs = len(cfg.get("scenarios", [])) * len(cfg.get("agents", [])) * len(cfg.get("fault_types", []))

    heatmap = None
    summary = None
    completed_runs = 0

    if job.results_json:
        results = json.loads(job.results_json)
        heatmap = results.get("heatmap")
        summary = results.get("aggregates")
        completed_runs = results.get("completed_runs", total_runs if job.status == "completed" else 0)

    return MatrixJobStatusResponse(
        job_id=job.id,
        status=job.status,
        total_runs=total_runs,
        completed_runs=completed_runs,
        created_at=job.created_at,
        completed_at=job.completed_at,
        heatmap=heatmap,
        summary=summary,
    )


@router.post("/shrink/{run_id}", response_model=MinimalFaultSet)
def shrink_run(run_id: str, max_reruns: int = Query(default=20, ge=1, le=50)):
    """Run ddmin fault reduction on a failed run to identify the minimal breaking set."""
    run = db_manager.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")

    if run.grader_result.verdict == "PASSED":
        raise HTTPException(status_code=400, detail="Cannot shrink a PASSED run; shrinking requires a failed run.")

    minimal_set = run_shrinker(run, max_reruns=max_reruns)
    return minimal_set


@router.post("/harden/{run_id}", response_model=HardeningResult)
def harden_run(run_id: str):
    """Auto-harden policy based on run failure and execute measured verification re-run."""
    run = db_manager.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")

    result = run_hardening_loop(run)
    # Save the re-run to DB
    re_run = db_manager.get_run(result.re_run_id)
    return result


@router.post("/diagnose/{run_id}", response_model=Diagnosis)
def diagnose_run(run_id: str):
    """Generate rule-based diagnosis strictly citing real trace event IDs."""
    run = db_manager.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")

    return DiagnosisEngine.diagnose_run(run)


@router.post("/predictor/train", response_model=PredictorTrainResponse)
def train_predictor():
    """Train failure-risk classifier on stored and synthetic reference runs."""
    runs = db_manager.list_runs(limit=1000)
    res = predictor_engine.train(runs)
    return res


@router.post("/predictor/predict", response_model=PredictorPredictResponse)
def predict_risk(req: PredictorPredictRequest):
    """Predict failure risk probability and key risk factors for a proposed setup."""
    return predictor_engine.predict(req)


@router.post("/simulator/generate")
def generate_simulator_runs(count: int = Query(default=50, ge=1, le=250)):
    """
    Executes real seeded simulator runs across varied scenarios, policies, and faults,
    labelled as simulator-generated and persisted in the database.
    """
    scenarios = ["healthy_service", "bad_deploy", "rollback_denied", "unfixable_rollback", "injected_instruction"]
    agents = ["naive", "robust"]
    fault_types = ["none", "timeout", "http_500", "malformed_json", "empty_response", "transient_then_success"]

    generated = []
    current_seed = 500
    idx = 0

    while len(generated) < count:
        scen = scenarios[idx % len(scenarios)]
        ag = agents[(idx // len(scenarios)) % len(agents)]
        ft = fault_types[(idx // (len(scenarios) * len(agents))) % len(fault_types)]
        intensity = (idx % 3) + 1 if ft != "none" else 0
        seed = current_seed + idx

        req = RunCreateRequest(
            scenario_id=scen,
            agent_type=ag,
            fault_type=None if ft == "none" else ft,
            fault_intensity=intensity,
            seed=seed,
        )
        res = run_experiment(req)
        db_manager.save_run(res)
        generated.append(res.id)
        idx += 1

    total_runs = len(db_manager.list_runs(limit=10000))
    return {
        "status": "ok",
        "generated_count": len(generated),
        "total_runs_in_db": total_runs,
        "message": f"Successfully generated {len(generated)} real simulator runs (labelled simulator-generated).",
    }


@router.get("/export/runs.json")
def export_runs_json():
    """Download full JSON archive of runs and aggregated metrics."""
    runs = db_manager.list_all_runs()
    analysis = DeterministicGrader.compute_dataset_analysis([r.model_dump() for r in runs])
    data = {
        "export_timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "aggregates": analysis["aggregates"],
        "runs": [r.model_dump() for r in runs],
    }
    return Response(
        content=json.dumps(data, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=agentprobe_runs.json"},
    )


@router.get("/export/report.md")
def export_report_md():
    """Download Markdown stress-testing report."""
    runs = db_manager.list_all_runs()
    md_content = generate_markdown_report(runs)
    return Response(
        content=md_content,
        media_type="text/markdown",
        headers={"Content-Disposition": "attachment; filename=agentprobe_report.md"},
    )


@router.get("/export/finetune.jsonl")
def export_finetune_jsonl():
    """Download sanitized training examples from successful RobustAgent runs only (optional LoRA workflow, not executed)."""
    runs = db_manager.list_all_runs()
    jsonl_content = generate_finetune_jsonl(runs)
    return Response(
        content=jsonl_content,
        media_type="application/x-ndjson",
        headers={"Content-Disposition": "attachment; filename=finetune.jsonl"},
    )


@router.delete("/history")
def clear_history(confirm: bool = Query(default=False)):
    """Clear all stored experiment records. Requires confirm=true."""
    if not confirm:
        raise HTTPException(
            status_code=400,
            detail="Confirmation required to clear history. Pass ?confirm=true query parameter.",
        )
    db_manager.clear_runs()
    return {"status": "ok", "message": "All experiment history cleared successfully."}
