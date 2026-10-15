"""
Unit and Integration Tests for FailureRiskPredictor:
1. No synthetic rows in training (sample_size == len(runs)).
2. The low-data warning fires when n < 200 ('Insufficient data: metrics are not meaningful').
3. Leakage-safe grouped split by scenario+seed holds with zero group overlap.
4. /api/simulator/generate endpoint produces simulator-generated runs.
"""
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.predictor import FailureRiskPredictor, get_leakage_safe_split
from app.schemas import (
    GraderResult,
    PolicyConfig,
    RunMetrics,
    RunResponse,
)


client = TestClient(app)


def _make_dummy_run(run_id: str, scenario_id: str, seed: int, verdict: str = "FAILED") -> RunResponse:
    return RunResponse(
        id=run_id,
        scenario_id=scenario_id,
        agent_type="naive",
        policy_config=PolicyConfig(max_retries=0, validate_schema=False, treat_output_as_data=False, verify_postconditions=False),
        seed=seed,
        fault_schedule=[],
        trace=[],
        grader_result=GraderResult(
            verdict=verdict,
            passed=verdict == "PASSED",
            goal_achieved=verdict == "PASSED",
            violations=[],
            expected_evidence=[],
            recovered=False,
            summary="test",
        ),
        metrics=RunMetrics(
            total_tool_calls=1,
            failed_tool_calls=0,
            recovered_tool_calls=0,
            duration_ms=10.0,
            retries_attempted=0,
            policy_violations=0,
        ),
        created_at="2026-10-15T12:00:00Z",
        provenance="simulator-generated",
    )


def test_no_synthetic_rows_in_training():
    predictor = FailureRiskPredictor()
    runs = [
        _make_dummy_run("r1", "bad_deploy", 10, "FAILED"),
        _make_dummy_run("r2", "bad_deploy", 20, "PASSED"),
        _make_dummy_run("r3", "healthy_service", 30, "PASSED"),
    ]
    res = predictor.train(runs)
    # Crucial assertion: exactly 3 rows, ZERO synthetic baseline rows added
    assert res.sample_size == 3
    assert res.real_runs_only is True


def test_low_data_warning_fires_under_200():
    predictor = FailureRiskPredictor()
    # 5 runs is < 200
    runs = [
        _make_dummy_run(f"r{i}", "bad_deploy" if i % 2 == 0 else "healthy_service", i * 10, "FAILED" if i % 2 == 0 else "PASSED")
        for i in range(5)
    ]
    res = predictor.train(runs)
    assert res.sample_size == 5
    assert res.is_insufficient_data is True
    assert res.metrics_meaningful is False
    assert res.status == "Insufficient data: metrics are not meaningful"
    assert "Insufficient data: metrics are not meaningful" in res.warning
    assert "small-data" in res.warning
    assert res.class_balance["failed"] > 0
    assert res.class_balance["passed"] > 0
    assert 0.0 < res.majority_class_baseline_accuracy <= 1.0


def test_leakage_safe_split_holds():
    # Construct groups representing scenario + seed
    groups = np.array([
        "bad_deploy_10", "bad_deploy_10", "bad_deploy_10",  # 3 runs sharing seed 10
        "bad_deploy_20", "bad_deploy_20",
        "healthy_30", "healthy_30", "healthy_30",
        "rollback_40", "rollback_40",
    ])
    train_idx, val_idx = get_leakage_safe_split(groups, test_size=0.3, random_state=42)

    train_groups = set(groups[train_idx])
    val_groups = set(groups[val_idx])

    # Assert that train and val groups have zero overlap (no leakage)
    assert train_groups.isdisjoint(val_groups)
    assert len(train_idx) > 0
    assert len(val_idx) > 0


def test_generate_simulator_runs_endpoint():
    res = client.post("/api/simulator/generate?count=6")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["generated_count"] == 6
    assert data["total_runs_in_db"] >= 6
