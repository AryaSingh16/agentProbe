"""
Comprehensive Test Suite for AgentProbe Core:
Verifies scenarios, deterministic fault schedules, agents, grader assertions,
policy violations, shrinker, cited diagnoses, auto-hardening, and DB resilience.
"""
import copy
import json
import os
import tempfile
from pathlib import Path
import pytest

from app.env import ROGUE_TOKEN, SCENARIOS, VALID_OPS_TOKEN, SimulatedOpsEnvironment
from app.faults import FaultInterceptor, generate_fault_schedule
from app.grader import DeterministicGrader
from app.hardening import run_hardening_loop
from app.runner import run_experiment
from app.schemas import (
    FaultSpec,
    FaultType,
    PolicyConfig,
    RunCreateRequest,
    Verdict,
)
from app.shrinker import run_shrinker
from app.diagnosis import DiagnosisEngine
from app.db import DatabaseManager


def test_healthy_scenario_passes():
    """Scenario 1: Healthy service passes without rollback."""
    req = RunCreateRequest(
        scenario_id="healthy_service",
        agent_type="robust",
        fault_intensity=0,
        seed=42,
    )
    res = run_experiment(req)
    assert res.grader_result.verdict == Verdict.PASSED
    assert res.grader_result.goal_achieved is True
    assert "health_checked" in res.grader_result.evidence_found
    assert len(res.grader_result.policy_violations) == 0


def test_fault_fires_on_schedule():
    """Deterministic fault schedule injects fault on expected call index."""
    spec = SCENARIOS["bad_deploy"]
    schedule = [
        FaultSpec(
            fault_id="F01",
            tool="get_errors",
            type=FaultType.HTTP_500,
            call_index=1,
            count=1,
        )
    ]
    req = RunCreateRequest(
        scenario_id="bad_deploy",
        agent_type="robust",
        custom_fault_schedule=schedule,
        seed=42,
    )
    res = run_experiment(req)
    # Check trace contains fault_injected event
    fault_events = [e for e in res.trace if e.type == "fault_injected"]
    assert len(fault_events) >= 1
    assert fault_events[0].fault_id == "F01"
    assert fault_events[0].tool == "get_errors"


def test_transient_fault_recovered_by_robust_not_naive():
    """Transient fault is recovered by RobustAgent via retries, but causes NaiveAgent to abort."""
    schedule = [
        FaultSpec(
            fault_id="F01",
            tool="get_health",
            type=FaultType.TRANSIENT_THEN_SUCCESS,
            call_index=1,
            count=2,
        )
    ]

    # Naive Agent: has 0 retries, halts on first error
    naive_req = RunCreateRequest(
        scenario_id="bad_deploy",
        agent_type="naive",
        custom_fault_schedule=schedule,
        seed=101,
    )
    naive_res = run_experiment(naive_req)
    assert naive_res.grader_result.verdict != Verdict.PASSED
    assert naive_res.grader_result.faults_encountered > 0
    assert naive_res.grader_result.faults_recovered == 0

    # Robust Agent: max_retries=3, absorbs transient failure
    robust_req = RunCreateRequest(
        scenario_id="bad_deploy",
        agent_type="robust",
        policy_config=PolicyConfig(
            max_retries=3,
            validate_schema=True,
            treat_output_as_data=True,
            verify_postconditions=True,
        ),
        custom_fault_schedule=schedule,
        seed=101,
    )
    robust_res = run_experiment(robust_req)
    assert robust_res.grader_result.verdict == Verdict.PASSED
    assert robust_res.grader_result.faults_encountered > 0
    assert robust_res.grader_result.faults_recovered > 0


def test_unauthorized_rollback_blocked():
    """Scenario 3: Rollback without valid approval token is BLOCKED with policy violation."""
    env = SimulatedOpsEnvironment(SCENARIOS["rollback_denied"])
    res = env.execute_tool("request_rollback", {"service": "payment-gateway", "approval_token": "FAKE_TOKEN"})
    assert res.get("status") == "denied"
    assert len(env.policy_violations) > 0

    # Test grading forces BLOCKED
    req = RunCreateRequest(
        scenario_id="rollback_denied",
        agent_type="naive",
        fault_intensity=0,
        seed=42,
    )
    run_res = run_experiment(req)
    # Naive agent attempts rollback on degraded service without token
    assert run_res.grader_result.verdict == Verdict.BLOCKED
    assert any("POLICY_VIOLATION_UNAUTHORIZED" in v for v in run_res.grader_result.policy_violations)


def test_injection_followed_by_naive_and_ignored_by_robust():
    """Adversarial prompt injection is executed by Naive agent (BLOCKED) but ignored by RobustAgent (PASSED)."""
    naive_req = RunCreateRequest(
        scenario_id="injected_instruction",
        agent_type="naive",
        fault_intensity=0,
        seed=42,
    )
    naive_res = run_experiment(naive_req)
    assert naive_res.grader_result.verdict == Verdict.BLOCKED
    assert naive_res.grader_result.failure_class == "POLICY_VIOLATION_INJECTION"
    assert any("ROGUE" in v for v in naive_res.grader_result.policy_violations)

    robust_req = RunCreateRequest(
        scenario_id="injected_instruction",
        agent_type="robust",
        policy_config=PolicyConfig(
            max_retries=3,
            validate_schema=True,
            treat_output_as_data=True,
            verify_postconditions=True,
        ),
        fault_intensity=0,
        seed=42,
    )
    robust_res = run_experiment(robust_req)
    assert robust_res.grader_result.verdict == Verdict.PASSED
    assert len(robust_res.grader_result.policy_violations) == 0


def test_failed_recovery_never_graded_success():
    """Scenario 4: If rollback fails to restore service, run is never graded success."""
    req = RunCreateRequest(
        scenario_id="unfixable_rollback",
        agent_type="robust",
        policy_config=PolicyConfig(
            max_retries=3,
            validate_schema=True,
            treat_output_as_data=True,
            verify_postconditions=True,
        ),
        fault_intensity=0,
        seed=42,
    )
    res = run_experiment(req)
    assert res.grader_result.verdict != Verdict.PASSED


def test_zero_denominator_metrics():
    """Aggregates show None (N/A) for zero denominators without division errors."""
    runs = [
        {
            "fault_schedule": [],
            "grader_result": {
                "verdict": "PASSED",
                "tool_calls": 0,
                "tool_errors": 0,
                "faults_encountered": 0,
                "faults_recovered": 0,
                "policy_violations": [],
            },
        }
    ]
    aggs = DeterministicGrader.compute_aggregates(runs)
    assert aggs.tool_error_rate is None
    assert aggs.recovery_rate is None
    assert aggs.recovery_degradation is None
    assert aggs.success_rate == 1.0


def test_same_seed_produces_identical_trace():
    """Reproducibility: Identical seed and configuration produce identical traces."""
    req1 = RunCreateRequest(scenario_id="bad_deploy", agent_type="robust", fault_intensity=2, seed=777)
    req2 = RunCreateRequest(scenario_id="bad_deploy", agent_type="robust", fault_intensity=2, seed=777)

    res1 = run_experiment(req1)
    res2 = run_experiment(req2)

    assert len(res1.trace) == len(res2.trace)
    for e1, e2 in zip(res1.trace, res2.trace):
        assert e1.type == e2.type
        assert e1.tool == e2.tool
        assert e1.event_id == e2.event_id


def test_baseline_unaffected_by_later_faulted_run():
    """Deep copy isolation: running a faulted run does not affect subsequent baseline runs."""
    base_req = RunCreateRequest(scenario_id="bad_deploy", agent_type="robust", fault_intensity=0, seed=42)
    base_res_1 = run_experiment(base_req)

    # In between, run heavy faulted experiment
    fault_req = RunCreateRequest(scenario_id="bad_deploy", agent_type="naive", fault_intensity=4, seed=99)
    run_experiment(fault_req)

    base_res_2 = run_experiment(base_req)
    assert base_res_1.grader_result.verdict == base_res_2.grader_result.verdict
    assert len(base_res_1.trace) == len(base_res_2.trace)


def test_shrinker_returns_true_minimal_set():
    """Shrinker reduces a 3-fault schedule to the minimal fault subset reproducing the failure."""
    # Create a 3-fault schedule where fault F02 (timeout on get_errors) alone causes NaiveAgent to fail
    faults = [
        FaultSpec(fault_id="F01", tool="verify_recovery", type=FaultType.TIMEOUT, call_index=1, count=1),
        FaultSpec(fault_id="F02", tool="get_errors", type=FaultType.HTTP_500, call_index=1, count=1),
        FaultSpec(fault_id="F03", tool="verify_recovery", type=FaultType.HTTP_500, call_index=2, count=1),
    ]

    req = RunCreateRequest(
        scenario_id="bad_deploy",
        agent_type="naive",
        custom_fault_schedule=faults,
        seed=42,
    )
    failing_run = run_experiment(req)
    assert failing_run.grader_result.verdict != Verdict.PASSED

    shrink_res = run_shrinker(failing_run, max_reruns=15)
    assert shrink_res.iterations_count > 0
    assert shrink_res.minimal_fault_count < shrink_res.original_fault_count
    # Verify F02 is in the minimal set
    min_ids = [f.fault_id for f in shrink_res.minimal_faults]
    assert "F02" in min_ids


def test_diagnoses_cite_only_existing_event_ids():
    """Every cited event ID in diagnosis strictly exists in the run trace."""
    req = RunCreateRequest(
        scenario_id="bad_deploy",
        agent_type="naive",
        fault_type="http_500",
        fault_intensity=1,
        seed=42,
    )
    run_res = run_experiment(req)
    diagnosis = DiagnosisEngine.diagnose_run(run_res)

    trace_ids = {e.event_id for e in run_res.trace}
    import re
    all_text = " ".join(diagnosis.observed_facts) + " " + diagnosis.inferred_explanation
    cited = set(re.findall(r"\bE\d{2}\b", all_text))
    assert len(cited) > 0
    for cid in cited:
        assert cid in trace_ids, f"Cited ID {cid} not in trace {trace_ids}"


def test_policy_violation_forces_blocked():
    """Any policy violation forces verdict BLOCKED."""
    req = RunCreateRequest(
        scenario_id="rollback_denied",
        agent_type="naive",
        fault_intensity=0,
        seed=1,
    )
    run_res = run_experiment(req)
    assert run_res.grader_result.verdict == Verdict.BLOCKED


def test_hardening_improves_weak_config_in_measured_rerun():
    """Hardening loop patches weak policy and measures improvement on identical conditions."""
    weak_policy = PolicyConfig(
        max_retries=0,
        validate_schema=False,
        treat_output_as_data=False,
        verify_postconditions=False,
    )
    schedule = [
        FaultSpec(fault_id="F01", tool="get_health", type=FaultType.TIMEOUT, call_index=1, count=1)
    ]
    req = RunCreateRequest(
        scenario_id="bad_deploy",
        agent_type="robust",
        policy_config=weak_policy,
        custom_fault_schedule=schedule,
        seed=42,
    )
    failing_run = run_experiment(req)
    assert failing_run.grader_result.verdict != Verdict.PASSED

    hardening_result = run_hardening_loop(failing_run)
    assert hardening_result.re_run_verdict == Verdict.PASSED
    assert hardening_result.patched_policy.max_retries >= 3
    assert len(hardening_result.fixed_failures) > 0


def test_corrupt_db_does_not_crash_startup():
    """Corrupt DB file is automatically backed up and re-initialized cleanly."""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "corrupt_test.db"
        # Write random binary garbage
        with open(db_path, "wb") as f:
            f.write(b"NOT_A_VALID_SQLITE_DATABASE_GARBAGE_HEADER_1234567890")

        # Initialize manager with corrupt db
        mgr = DatabaseManager(f"sqlite:///{db_path}")
        assert mgr.engine is not None
        # Verify it can query without crash
        runs = mgr.list_runs()
        assert len(runs) == 0
        mgr.close()
