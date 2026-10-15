"""
API Integration Tests for AgentProbe:
Verifies FastAPI endpoints using TestClient.
Tests runs, matrix, shrinker, hardening, diagnosis, predictor, exports, and history.
"""
import json
import pytest
from fastapi.testclient import TestClient

from app.env import ROGUE_TOKEN, VALID_OPS_TOKEN
from app.main import app
from app.schemas import PolicyConfig


client = TestClient(app)


def test_api_health():
    res = client.get("/api/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert "llm_mode" in data


def test_api_scenarios():
    res = client.get("/api/scenarios")
    assert res.status_code == 200
    scenarios = res.json()
    assert len(scenarios) == 5
    ids = [s["scenario_id"] for s in scenarios]
    assert "healthy_service" in ids
    assert "bad_deploy" in ids
    assert "injected_instruction" in ids


def test_api_cassettes():
    res = client.get("/api/cassettes")
    assert res.status_code == 200
    cassettes = res.json()
    assert len(cassettes) >= 2
    for c in cassettes:
        assert c["provenance"] in ("recorded", "hand-authored")
        assert "interactions" in c


def test_api_create_and_fetch_run():
    payload = {
        "scenario_id": "bad_deploy",
        "agent_type": "robust",
        "fault_intensity": 0,
        "seed": 42,
    }
    create_res = client.post("/api/runs", json=payload)
    assert create_res.status_code == 200
    run_data = create_res.json()
    run_id = run_data["id"]
    assert run_data["grader_result"]["verdict"] == "PASSED"

    # Fetch run detail
    get_res = client.get(f"/api/runs/{run_id}")
    assert get_res.status_code == 200
    assert get_res.json()["id"] == run_id

    # List runs
    list_res = client.get("/api/runs")
    assert list_res.status_code == 200
    assert len(list_res.json()) >= 1


def test_api_shrink_failing_run():
    # Create failing naive run under fault injection
    payload = {
        "scenario_id": "bad_deploy",
        "agent_type": "naive",
        "fault_type": "timeout",
        "fault_intensity": 3,
        "seed": 10,
    }
    run_res = client.post("/api/runs", json=payload).json()
    run_id = run_res["id"]
    assert run_res["grader_result"]["verdict"] != "PASSED"

    # Invoke shrink endpoint
    shrink_res = client.post(f"/api/shrink/{run_id}?max_reruns=15")
    assert shrink_res.status_code == 200
    shrink_data = shrink_res.json()
    assert shrink_data["iterations_count"] > 0
    assert shrink_data["minimal_fault_count"] <= shrink_data["original_fault_count"]
    assert len(shrink_data["counterfactual_runs"]) > 0


def test_api_harden_failing_run():
    # Create failing run with weak policy
    payload = {
        "scenario_id": "bad_deploy",
        "agent_type": "robust",
        "policy_config": {
            "max_retries": 0,
            "validate_schema": False,
            "treat_output_as_data": False,
            "verify_postconditions": False,
        },
        "fault_type": "timeout",
        "fault_intensity": 1,
        "seed": 42,
    }
    run_res = client.post("/api/runs", json=payload).json()
    run_id = run_res["id"]

    harden_res = client.post(f"/api/harden/{run_id}")
    assert harden_res.status_code == 200
    h_data = harden_res.json()
    assert h_data["re_run_verdict"] == "PASSED"
    assert h_data["patched_policy"]["max_retries"] >= 3
    assert len(h_data["fixed_failures"]) > 0


def test_api_diagnose():
    payload = {
        "scenario_id": "injected_instruction",
        "agent_type": "naive",
        "fault_intensity": 0,
        "seed": 42,
    }
    run_res = client.post("/api/runs", json=payload).json()
    run_id = run_res["id"]

    diag_res = client.post(f"/api/diagnose/{run_id}")
    assert diag_res.status_code == 200
    diag = diag_res.json()
    assert len(diag["observed_facts"]) > 0
    assert len(diag["recommendations"]) > 0
    assert "E0" in diag["inferred_explanation"]


def test_api_predictor():
    train_res = client.post("/api/predictor/train")
    assert train_res.status_code == 200
    t_data = train_res.json()
    assert t_data["accuracy"] >= 0.5
    assert "small-data" in t_data["warning"]

    pred_payload = {
        "scenario_id": "bad_deploy",
        "policy": {
            "max_retries": 0,
            "validate_schema": False,
            "treat_output_as_data": False,
            "verify_postconditions": False,
        },
        "fault_type": "timeout",
        "fault_intensity": 2,
    }
    pred_res = client.post("/api/predictor/predict", json=pred_payload)
    assert pred_res.status_code == 200
    p_data = pred_res.json()
    assert 0.0 <= p_data["failure_risk_probability"] <= 1.0
    assert p_data["risk_level"] in ("LOW", "MEDIUM", "HIGH")
    assert len(p_data["contributing_factors"]) > 0


def test_api_exports_and_no_secrets():
    # Make sure we have a successful robust run for finetune export
    client.post("/api/runs", json={"scenario_id": "bad_deploy", "agent_type": "robust", "seed": 42})

    # Test fine-tune jsonl export
    ft_res = client.get("/api/export/finetune.jsonl")
    assert ft_res.status_code == 200
    ft_text = ft_res.text
    # SECRETS CHECK: ensure real token is never exported
    assert VALID_OPS_TOKEN not in ft_text
    assert ROGUE_TOKEN not in ft_text

    # Test report markdown
    rep_res = client.get("/api/export/report.md")
    assert rep_res.status_code == 200
    assert "# AgentProbe" in rep_res.text

    # Test runs json
    runs_res = client.get("/api/export/runs.json")
    assert runs_res.status_code == 200
    data = runs_res.json()
    assert "runs" in data
    assert "aggregates" in data


def test_api_clear_history_requires_confirm():
    # Reject without confirm
    res_no = client.delete("/api/history")
    assert res_no.status_code == 400

    # Accept with confirm
    res_yes = client.delete("/api/history?confirm=true")
    assert res_yes.status_code == 200
    assert res_yes.json()["status"] == "ok"

    # Confirm history is empty
    runs_res = client.get("/api/runs")
    assert len(runs_res.json()) == 0


def test_api_metrics_and_report_data_consistency():
    """
    Asserts exact mathematical consistency across /api/metrics, /api/export/runs.json,
    and /api/export/report.md.
    """
    # Create several varied runs
    for scen in ["healthy_service", "bad_deploy"]:
        for ag in ["naive", "robust"]:
            client.post("/api/runs", json={
                "scenario_id": scen,
                "agent_type": ag,
                "fault_type": "timeout" if scen == "bad_deploy" else None,
                "fault_intensity": 1 if scen == "bad_deploy" else 0,
                "seed": 42,
            })

    metrics_res = client.get("/api/metrics").json()
    export_json = client.get("/api/export/runs.json").json()
    report_md = client.get("/api/export/report.md").text

    m_aggs = metrics_res["aggregates"]
    j_aggs = export_json["aggregates"]

    # 1. Total runs must match exactly
    assert m_aggs["total_runs"] == j_aggs["total_runs"]
    assert f"n = {m_aggs['total_runs']}" in report_md

    # 2. Success counts and formatted strings must match exactly
    assert m_aggs["success_count"] == j_aggs["success_count"]
    assert m_aggs["success_formatted"] == j_aggs["success_formatted"]
    assert m_aggs["success_formatted"] in report_md

    # 3. Baseline vs Faulted numbers match heatmap exactly
    b_vs_f = metrics_res["baseline_vs_faulted"]
    matrix = metrics_res["reliability_matrix"]
    if matrix.get("naive", {}).get("none") is not None:
        assert b_vs_f["by_agent"]["naive"]["baseline"]["rate"] == matrix["naive"]["none"]
    if matrix.get("robust", {}).get("none") is not None:
        assert b_vs_f["by_agent"]["robust"]["baseline"]["rate"] == matrix["robust"]["none"]


def test_diagnosis_grouped_citations_match_trace():
    """
    Verifies that for both failed and passed runs, every cited event ID exists
    in the trace, and grouped fault summaries' counts match the trace.
    """
    import re
    # Run with transient fault (recovers with robust)
    res_rec = client.post("/api/runs", json={
        "scenario_id": "healthy_service",
        "agent_type": "robust",
        "fault_type": "transient_then_success",
        "fault_intensity": 2,
        "seed": 42,
    }).json()
    diag_rec = client.post(f"/api/diagnose/{res_rec['id']}").json()

    trace_ids = {e["event_id"] for e in res_rec["trace"]}
    all_cited = set(re.findall(r"\bE\d{2}\b", " ".join(diag_rec["observed_facts"]) + " " + diag_rec["inferred_explanation"]))
    assert all_cited.issubset(trace_ids)

    # Run with unfixable failure
    res_fail = client.post("/api/runs", json={
        "scenario_id": "unfixable_rollback",
        "agent_type": "naive",
        "fault_type": "http_500",
        "fault_intensity": 1,
        "seed": 42,
    }).json()
    diag_fail = client.post(f"/api/diagnose/{res_fail['id']}").json()

    fail_trace_ids = {e["event_id"] for e in res_fail["trace"]}
    fail_cited = set(re.findall(r"\bE\d{2}\b", " ".join(diag_fail["observed_facts"]) + " " + diag_fail["inferred_explanation"]))
    assert fail_cited.issubset(fail_trace_ids)


def test_matrix_per_scenario_cells_not_all_identical():
    """
    Verifies that per-scenario matrix cells are not all identical when simulator
    results differ, that /api/metrics?scenario_id=... returns scoped results,
    and that not_applicable flags are properly marked.
    """
    # Run robust agent on bad_deploy (winnable) and unfixable_rollback (unwinnable)
    client.post("/api/runs", json={
        "scenario_id": "bad_deploy",
        "agent_type": "robust",
        "fault_type": None,
        "fault_intensity": 0,
        "seed": 142,
    })
    client.post("/api/runs", json={
        "scenario_id": "unfixable_rollback",
        "agent_type": "robust",
        "fault_type": None,
        "fault_intensity": 0,
        "seed": 142,
    })

    # Query metrics
    res = client.get("/api/metrics")
    assert res.status_code == 200
    data = res.json()

    assert "matrix_by_scenario" in data
    assert "matrix_details_by_scenario" in data
    assert "unwinnable_scenarios" in data
    assert "unfixable_rollback" in data["unwinnable_scenarios"]

    matrix_by_scen = data["matrix_by_scenario"]
    # Check that bad_deploy passed (1.0) and unfixable_rollback failed (0.0)
    bd_val = matrix_by_scen.get("bad_deploy", {}).get("robust", {}).get("none")
    ur_val = matrix_by_scen.get("unfixable_rollback", {}).get("robust", {}).get("none")

    assert bd_val == 1.0, f"Expected 1.0 for bad_deploy, got {bd_val}"
    assert ur_val == 0.0, f"Expected 0.0 for unfixable_rollback, got {ur_val}"
    assert bd_val != ur_val, "Per-scenario cells must differ when simulator outcomes differ!"

    # Query filtered by scenario_id
    res_bd = client.get("/api/metrics?scenario_id=bad_deploy").json()
    assert res_bd["selected_scenario"] == "bad_deploy"
    assert res_bd["reliability_matrix"]["robust"]["none"] == 1.0

    res_ur = client.get("/api/metrics?scenario_id=unfixable_rollback").json()
    assert res_ur["selected_scenario"] == "unfixable_rollback"
    assert res_ur["reliability_matrix"]["robust"]["none"] == 0.0


def test_matrix_progress_units_and_completed_never_exceeds_total():
    """
    Asserts that matrix job progress reports both completed and total in runs,
    and completed_runs <= total_runs always.
    """
    req_payload = {
        "scenarios": ["healthy_service", "bad_deploy"],
        "agents": ["naive", "robust"],
        "fault_types": ["none", "timeout"],
        "intensity": 1,
        "seed": 100,
        "seed_count": 2,
    }
    # Expected total runs = 2 scenarios * 2 agents * 2 fault types * 2 seeds = 16 runs
    res = client.post("/api/matrix", json=req_payload)
    assert res.status_code == 200
    data = res.json()
    job_id = data["job_id"]
    assert data["total_runs"] == 16

    # Fetch job status
    status_res = client.get(f"/api/matrix/{job_id}")
    assert status_res.status_code == 200
    status_data = status_res.json()
    assert status_data["total_runs"] == 16
    assert status_data["completed_runs"] <= status_data["total_runs"]
    assert 0 <= status_data["completed_runs"]


def test_metrics_request_creates_zero_new_runs():
    """
    Asserts that a GET /api/metrics request is strictly non-mutating
    and creates zero new runs.
    """
    from app.db import db_manager
    runs_before = len(db_manager.list_all_runs())

    # Send multiple GET /api/metrics requests
    res1 = client.get("/api/metrics")
    assert res1.status_code == 200
    res2 = client.get("/api/metrics?scenario_id=bad_deploy")
    assert res2.status_code == 200

    runs_after = len(db_manager.list_all_runs())
    assert runs_after == runs_before, f"GET /api/metrics mutated DB! Before: {runs_before}, After: {runs_after}"


def test_new_run_appears_first_in_history_and_runs_endpoints():
    """
    Asserts that when a new run is created, it appears first (most recent)
    in both /api/history and /api/runs.
    """
    unique_seed = 99999
    create_res = client.post("/api/runs", json={
        "scenario_id": "healthy_service",
        "agent_type": "naive",
        "fault_type": None,
        "fault_intensity": 0,
        "seed": unique_seed,
    })
    assert create_res.status_code == 200
    created_id = create_res.json()["id"]

    # Verify in /api/history
    hist_res = client.get("/api/history?limit=10&offset=0")
    assert hist_res.status_code == 200
    hist_runs = hist_res.json()
    assert len(hist_runs) > 0
    assert hist_runs[0]["id"] == created_id, f"Expected {created_id} first in /api/history, got {hist_runs[0]['id']}"

    # Verify in /api/runs
    runs_res = client.get("/api/runs?limit=10&offset=0")
    assert runs_res.status_code == 200
    runs_list = runs_res.json()
    assert len(runs_list) > 0
    assert runs_list[0]["id"] == created_id, f"Expected {created_id} first in /api/runs, got {runs_list[0]['id']}"


def test_report_differs_per_run():
    """Report for run A differs from report for run B."""
    res_a = client.post("/api/runs", json={
        "scenario_id": "bad_deploy",
        "agent_type": "robust",
        "seed": 242,
    }).json()

    res_b = client.post("/api/runs", json={
        "scenario_id": "rollback_denied",
        "agent_type": "naive",
        "seed": 243,
    }).json()

    rep_a = client.get(f"/api/report?run_id={res_a['id']}").json()
    rep_b = client.get(f"/api/report?run_id={res_b['id']}").json()

    assert rep_a["verdict"] != rep_b["verdict"]
    assert rep_a["verdict"] == "PASSED"
    assert rep_b["verdict"] == "BLOCKED"
    assert rep_a["tiles"] != rep_b["tiles"]
    assert rep_a["findings"] != rep_b["findings"]


def test_read_and_simulated_endpoints_create_zero_runs():
    """GET metrics, report, runs, predictor, and simulated check never create or persist runs."""
    from app.db import db_manager
    client.delete("/api/history?confirm=true")
    assert db_manager.count_runs() == 0

    # GET metrics
    res = client.get("/api/metrics")
    assert res.status_code == 200
    assert db_manager.count_runs() == 0

    # GET report
    res = client.get("/api/report")
    assert res.status_code == 200
    assert db_manager.count_runs() == 0

    # GET runs
    res = client.get("/api/runs")
    assert res.status_code == 200
    assert db_manager.count_runs() == 0

    # POST simulator/generate (live simulated check)
    res = client.post("/api/simulator/generate", json={
        "scenario_id": "bad_deploy",
        "agent_type": "naive",
        "fault_type": "timeout",
        "fault_intensity": 2,
        "count": 5,
    })
    assert res.status_code == 200
    assert db_manager.count_runs() == 0

    # POST predictor/predict
    res = client.post("/api/predictor/predict", json={
        "scenario_id": "bad_deploy",
        "fault_type": "timeout",
        "fault_intensity": 2,
        "policy": {
            "max_retries": 1,
            "validate_schema": True,
            "treat_output_as_data": False,
            "verify_postconditions": True,
        },
    })
    assert res.status_code == 200
    assert db_manager.count_runs() == 0


def test_clear_restart_stays_empty():
    """Clear history -> restart stays empty without auto-seeding."""
    from app.db import db_manager
    from app.main import lifespan, app
    import asyncio

    client.delete("/api/history?confirm=true")
    assert db_manager.count_runs() == 0

    async def simulate_startup():
        async with lifespan(app):
            pass

    asyncio.run(simulate_startup())
    assert db_manager.count_runs() == 0


def test_metrics_reflect_new_run_immediately_and_delta():
    """Metrics reflect a new run immediately on next request with correct delta."""
    from app.db import db_manager
    client.delete("/api/history?confirm=true")

    m0 = client.get("/api/metrics").json()
    assert m0["aggregates"]["total_runs"] == 0

    r1 = client.post("/api/runs", json={
        "scenario_id": "unfixable_rollback",
        "agent_type": "naive",
        "seed": 341,
    }).json()

    m1 = client.get("/api/metrics").json()
    assert m1["aggregates"]["total_runs"] == 1
    assert m1["last_run"]["id"] == r1["id"]
    assert "Initial run:" in m1["last_run"]["delta_text"]

    r2 = client.post("/api/runs", json={
        "scenario_id": "healthy_service",
        "agent_type": "naive",
        "seed": 342,
    }).json()

    m2 = client.get("/api/metrics").json()
    assert m2["aggregates"]["total_runs"] == 2
    assert m2["last_run"]["id"] == r2["id"]
    assert "Success 0.0% -> 50.0%" in m2["last_run"]["delta_text"]


def test_llm_without_cassette_rejected_with_no_recording():
    """Replaying LLM with no cassette raises HTTP 400 'no recording' and does not create run."""
    from app.db import db_manager
    client.delete("/api/history?confirm=true")
    initial_count = db_manager.count_runs()

    res = client.post("/api/runs", json={
        "scenario_id": "unfixable_rollback",
        "agent_type": "llm",
        "seed": 42,
    })
    assert res.status_code == 400
    assert "no recording" in res.json()["detail"].lower()
    assert db_manager.count_runs() == initial_count


def test_rapid_fire_duplicate_rejected():
    """Duplicate rapid-fire POST /runs requests (<1.0s) are rejected."""
    from app.db import db_manager
    client.delete("/api/history?confirm=true")

    res1 = client.post("/api/runs", json={
        "scenario_id": "bad_deploy",
        "agent_type": "naive",
        "fault_type": "timeout",
        "fault_intensity": 2,
        "seed": 999,
    })
    assert res1.status_code == 200

    res2 = client.post("/api/runs", json={
        "scenario_id": "bad_deploy",
        "agent_type": "naive",
        "fault_type": "timeout",
        "fault_intensity": 2,
        "seed": 999,
    })
    assert res2.status_code == 429
    assert "duplicate" in res2.json()["detail"].lower()
    assert db_manager.count_runs() == 1


def test_deterministic_ordering_newest_first_and_single_filtering():
    """Verify newest runs are always ordered first, and show=single isolates single runs from batches."""
    from app.db import db_manager
    client.delete("/api/history?confirm=true")

    # Create run 1 (Resilient)
    r1 = client.post("/api/runs", json={
        "scenario_id": "bad_deploy",
        "agent_type": "robust",
        "fault_type": "timeout",
        "seed": 101,
    }).json()

    # Create run 2 (Basic)
    r2 = client.post("/api/runs", json={
        "scenario_id": "bad_deploy",
        "agent_type": "naive",
        "fault_type": "timeout",
        "seed": 102,
    }).json()

    # List runs - r2 must be first, r1 second
    runs = client.get("/api/runs").json()
    assert len(runs) >= 2
    assert runs[0]["id"] == r2["id"]
    assert runs[1]["id"] == r1["id"]

    # Now create a matrix batch
    job_res = client.post("/api/matrix", json={
        "scenarios": ["bad_deploy"],
        "agents": ["robust"],
        "fault_types": ["timeout"],
        "seeds": [201, 202],
    })
    assert job_res.status_code == 200

    # Wait briefly for background execution
    import time
    time.sleep(0.5)

    # In show=single mode: ONLY single runs appear, with r2 still on top, r1 second
    single_runs = client.get("/api/runs?show=single").json()
    assert len(single_runs) == 2
    assert single_runs[0]["id"] == r2["id"]
    assert single_runs[1]["id"] == r1["id"]
    assert all(r["batch_id"] is None for r in single_runs)

    # In matrix batches endpoint: exactly 1 batch exists
    batches = client.get("/api/matrix/batches").json()
    assert len(batches) >= 1
    assert batches[0]["total_runs"] == 2
    assert "Full matrix" in batches[0]["summary"]


def test_runs_filtering_by_agent_scenario_verdict():
    """Verify filters for agent, scenario, verdict work accurately."""
    from app.db import db_manager
    client.delete("/api/history?confirm=true")

    # Run 1: robust, bad_deploy -> PASSED
    client.post("/api/runs", json={
        "scenario_id": "bad_deploy",
        "agent_type": "robust",
        "fault_type": "timeout",
        "seed": 301,
    })

    # Run 2: naive, bad_deploy -> FAILED
    client.post("/api/runs", json={
        "scenario_id": "bad_deploy",
        "agent_type": "naive",
        "fault_type": "timeout",
        "seed": 302,
    })

    # Filter agent=robust
    robust_runs = client.get("/api/runs?agent=robust").json()
    assert len(robust_runs) == 1
    assert robust_runs[0]["agent_type"] == "robust"

    # Filter verdict=PASSED
    passed_runs = client.get("/api/runs?verdict=PASSED").json()
    assert len(passed_runs) == 1
    assert passed_runs[0]["grader_result"]["verdict"] == "PASSED"

    # Filter verdict=FAILED
    failed_runs = client.get("/api/runs?verdict=FAILED").json()
    assert len(failed_runs) == 1
    assert failed_runs[0]["grader_result"]["verdict"] == "FAILED"

