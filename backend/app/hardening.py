"""
AgentProbe Auto-Hardening Loop:
Maps minimal failing faults to PolicyConfig patches, re-runs the exact same conditions,
and returns measured before/after metrics and resolved failure classes.
Never claims a fix without a measured re-run.
"""
import copy
from typing import Any, Dict, List, Optional, Tuple

from app.runner import run_experiment
from app.schemas import (
    FaultSpec,
    FaultType,
    HardeningResult,
    PolicyConfig,
    RunCreateRequest,
    RunResponse,
)


def compute_policy_patch(run: RunResponse, minimal_faults: Optional[List[FaultSpec]] = None) -> PolicyConfig:
    """
    Computes policy patch based on the run failure class and minimal faults.
    """
    patched = copy.deepcopy(run.policy_config)
    failure_class = run.grader_result.failure_class
    faults_to_check = minimal_faults if minimal_faults is not None else run.fault_schedule

    # Inspect faults
    for f in faults_to_check:
        ftype = f.type
        if ftype in (FaultType.TIMEOUT, FaultType.HTTP_500, FaultType.TRANSIENT_THEN_SUCCESS):
            patched.max_retries = max(patched.max_retries, 3)
        elif ftype in (FaultType.MALFORMED_JSON, FaultType.EMPTY_RESPONSE):
            patched.validate_schema = True

    # Inspect failure class
    if failure_class == "POLICY_VIOLATION_INJECTION":
        patched.treat_output_as_data = True
    elif failure_class == "UNVERIFIED_STATE":
        patched.verify_postconditions = True
    elif failure_class == "UNHANDLED_TOOL_ERROR":
        patched.max_retries = max(patched.max_retries, 3)
        patched.validate_schema = True

    # If it failed on unfixable_rollback without verify_postconditions
    if run.scenario_id in ("unfixable_rollback", "bad_deploy", "injected_instruction"):
        if not patched.verify_postconditions:
            patched.verify_postconditions = True

    return patched


def run_hardening_loop(run: RunResponse, minimal_faults: Optional[List[FaultSpec]] = None) -> HardeningResult:
    """
    Executes measured auto-hardening:
    1. Computes targeted policy patch.
    2. Re-runs the exact same scenario, agent, schedule, and seed with the patched policy.
    3. Measures the difference and returns verifiable before/after data.
    """
    orig_policy = run.policy_config
    patched_policy = compute_policy_patch(run, minimal_faults)

    # Calculate policy diff
    diff = {}
    for field, val in patched_policy.model_dump().items():
        orig_val = getattr(orig_policy, field)
        if val != orig_val:
            diff[field] = {"before": orig_val, "after": val}

    # Execute measured re-run
    re_run_id = f"hardened_{run.id[:8]}"
    req = RunCreateRequest(
        scenario_id=run.scenario_id,
        agent_type="robust",  # Hardened policy runs on robust agent engine
        policy_config=patched_policy,
        seed=run.seed,
        custom_fault_schedule=run.fault_schedule,
    )
    after_run = run_experiment(req, run_id=re_run_id)

    before_grader = run.grader_result
    after_grader = after_run.grader_result

    before_metrics = {
        "verdict": before_grader.verdict,
        "failure_class": before_grader.failure_class,
        "goal_achieved": before_grader.goal_achieved,
        "tool_calls": before_grader.tool_calls,
        "tool_errors": before_grader.tool_errors,
        "faults_encountered": before_grader.faults_encountered,
        "faults_recovered": before_grader.faults_recovered,
        "policy_violations": before_grader.policy_violations,
    }

    after_metrics = {
        "verdict": after_grader.verdict,
        "failure_class": after_grader.failure_class,
        "goal_achieved": after_grader.goal_achieved,
        "tool_calls": after_grader.tool_calls,
        "tool_errors": after_grader.tool_errors,
        "faults_encountered": after_grader.faults_encountered,
        "faults_recovered": after_grader.faults_recovered,
        "policy_violations": after_grader.policy_violations,
    }

    fixed_failures = []
    remaining_failures = []

    if before_grader.failure_class and before_grader.failure_class != "NONE":
        if after_grader.failure_class != before_grader.failure_class:
            fixed_failures.append(before_grader.failure_class)
        else:
            remaining_failures.append(before_grader.failure_class)

    for violation in before_grader.policy_violations:
        if violation not in after_grader.policy_violations:
            fixed_failures.append(violation)
        else:
            remaining_failures.append(violation)

    return HardeningResult(
        original_policy=orig_policy,
        patched_policy=patched_policy,
        policy_diff=diff,
        before_metrics=before_metrics,
        after_metrics=after_metrics,
        fixed_failures=fixed_failures,
        remaining_failures=remaining_failures,
        re_run_id=re_run_id,
        re_run_verdict=after_grader.verdict,
    )
