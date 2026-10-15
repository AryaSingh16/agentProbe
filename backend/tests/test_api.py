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
