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
    PredictorPredictRequest,
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
    from app.db import db_manager
    count_before = db_manager.count_runs()
    res = client.post("/api/simulator/generate?count=6")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["generated_count"] == 6
    assert db_manager.count_runs() == count_before


def test_predictor_predictions_differ_across_fault_types():
    """
    Verifies estimator predictions differ across at least 3 different fault types
    where simulator outcomes differ (none, timeout, malformed_json).
    """
    predictor = FailureRiskPredictor()
    policy = PolicyConfig(max_retries=0, validate_schema=False, treat_output_as_data=True, verify_postconditions=True)

    res_none = predictor.predict(PredictorPredictRequest(
        scenario_id="bad_deploy", policy=policy, fault_type="none", fault_intensity=0
    ))
    res_timeout = predictor.predict(PredictorPredictRequest(
        scenario_id="bad_deploy", policy=policy, fault_type="timeout", fault_intensity=2
    ))
    res_malformed = predictor.predict(PredictorPredictRequest(
        scenario_id="bad_deploy", policy=policy, fault_type="malformed_json", fault_intensity=2
    ))

    # All three probabilities must be distinct
    distinct_probs = {
        res_none.failure_risk_probability,
        res_timeout.failure_risk_probability,
        res_malformed.failure_risk_probability,
    }
    assert len(distinct_probs) == 3, f"Expected 3 distinct probabilities, got {distinct_probs}"

    # Also verify per-fault-risks breakdown has distinct values
    assert res_none.per_fault_risks is not None
    assert len(res_none.per_fault_risks) == 6
    assert res_none.per_fault_risks["none"] != res_none.per_fault_risks["timeout"]


def test_toggling_each_guardrail_changes_estimate_in_same_direction_as_simulator():
    """
    Verifies that toggling each of the 4 guardrails reduces estimated failure risk,
    moving in the same direction as the empirical simulator check.
    """
    predictor = FailureRiskPredictor()

    # Guardrail 1: max_retries under timeout
    base_retries = predictor.predict(PredictorPredictRequest(
        scenario_id="bad_deploy",
        policy=PolicyConfig(max_retries=0, validate_schema=True, treat_output_as_data=True, verify_postconditions=True),
        fault_type="timeout",
        fault_intensity=1,
    ))
    on_retries = predictor.predict(PredictorPredictRequest(
        scenario_id="bad_deploy",
        policy=PolicyConfig(max_retries=3, validate_schema=True, treat_output_as_data=True, verify_postconditions=True),
        fault_type="timeout",
        fault_intensity=1,
    ))
    assert on_retries.failure_risk_probability < base_retries.failure_risk_probability
    assert on_retries.simulated_check_rate <= base_retries.simulated_check_rate

    # Guardrail 2: validate_schema under malformed_json
    base_schema = predictor.predict(PredictorPredictRequest(
        scenario_id="bad_deploy",
        policy=PolicyConfig(max_retries=3, validate_schema=False, treat_output_as_data=True, verify_postconditions=True),
        fault_type="malformed_json",
        fault_intensity=1,
    ))
    on_schema = predictor.predict(PredictorPredictRequest(
        scenario_id="bad_deploy",
        policy=PolicyConfig(max_retries=3, validate_schema=True, treat_output_as_data=True, verify_postconditions=True),
        fault_type="malformed_json",
        fault_intensity=1,
    ))
    assert on_schema.failure_risk_probability < base_schema.failure_risk_probability
    assert on_schema.simulated_check_rate <= base_schema.simulated_check_rate

    # Guardrail 3: treat_output_as_data under prompt injection
    base_data = predictor.predict(PredictorPredictRequest(
        scenario_id="injected_instruction",
        policy=PolicyConfig(max_retries=3, validate_schema=True, treat_output_as_data=False, verify_postconditions=True),
        fault_type="none",
        fault_intensity=0,
    ))
    on_data = predictor.predict(PredictorPredictRequest(
        scenario_id="injected_instruction",
        policy=PolicyConfig(max_retries=3, validate_schema=True, treat_output_as_data=True, verify_postconditions=True),
        fault_type="none",
        fault_intensity=0,
    ))
    assert on_data.failure_risk_probability < base_data.failure_risk_probability
    assert on_data.simulated_check_rate <= base_data.simulated_check_rate

    # Guardrail 4: verify_postconditions after mutation
    base_post = predictor.predict(PredictorPredictRequest(
        scenario_id="bad_deploy",
        policy=PolicyConfig(max_retries=3, validate_schema=True, treat_output_as_data=True, verify_postconditions=False),
        fault_type="none",
        fault_intensity=0,
    ))
    on_post = predictor.predict(PredictorPredictRequest(
        scenario_id="bad_deploy",
        policy=PolicyConfig(max_retries=3, validate_schema=True, treat_output_as_data=True, verify_postconditions=True),
        fault_type="none",
        fault_intensity=0,
    ))
    assert on_post.failure_risk_probability < base_post.failure_risk_probability
    assert on_post.simulated_check_rate <= base_post.simulated_check_rate
