"""
AgentProbe Fault Shrinker: Delta-debugging (ddmin) algorithm over FaultSchedules.
Finds the minimal subset of faults that reproduces the exact same failure class.
Enforces a hard cap of 20 reruns and outputs counterfactual runs as proof.
"""
from typing import Any, Dict, List, Optional, Tuple
import copy

from app.runner import run_experiment
from app.schemas import FaultSpec, MinimalFaultSet, RunCreateRequest, RunResponse


def run_shrinker(run: RunResponse, max_reruns: int = 20) -> MinimalFaultSet:
    """
    Applies ddmin reduction over the run's fault schedule to find the minimal
    fault set that preserves the run's failure class.
    """
    original_schedule = list(run.fault_schedule)
    target_failure_class = run.grader_result.failure_class
    target_verdict = run.grader_result.verdict

    if not original_schedule or not target_failure_class or target_failure_class == "NONE":
        return MinimalFaultSet(
            minimal_faults=original_schedule,
            counterfactual_runs=[],
            iterations_count=0,
            original_fault_count=len(original_schedule),
            minimal_fault_count=len(original_schedule),
        )

    counterfactual_runs: List[Dict[str, Any]] = []
    reruns_count = 0

    def evaluate_candidate(candidate_faults: List[FaultSpec]) -> Tuple[RunResponse, bool]:
        nonlocal reruns_count
        reruns_count += 1
        sub_id = f"cf_{run.id[:8]}_{reruns_count:02d}"

        req = RunCreateRequest(
            scenario_id=run.scenario_id,
            agent_type=run.agent_type,
            policy_config=run.policy_config,
            seed=run.seed,
            custom_fault_schedule=candidate_faults,
        )
        res = run_experiment(req, run_id=sub_id)

        same_failure = (res.grader_result.failure_class == target_failure_class)
        counterfactual_runs.append({
            "run_id": sub_id,
            "fault_count": len(candidate_faults),
            "fault_ids": [f.fault_id for f in candidate_faults],
            "verdict": res.grader_result.verdict,
            "failure_class": res.grader_result.failure_class,
            "reproduces_target_failure": same_failure,
        })
        return res, same_failure

    current_faults = list(original_schedule)
    n = 2

    # ddmin main loop
    while len(current_faults) >= 2 and reruns_count < max_reruns:
        # Partition current_faults into n subsets
        subsets: List[List[FaultSpec]] = []
        k = len(current_faults)
        step = max(1, k // n)

        for i in range(0, k, step):
            subsets.append(current_faults[i:i + step])

        reduced = False

        # Phase A: Check subsets
        for subset in subsets:
            if reruns_count >= max_reruns:
                break
            _, reproduces = evaluate_candidate(subset)
            if reproduces:
                current_faults = subset
                n = 2
                reduced = True
                break

        if reduced:
            continue

        # Phase B: Check complements (current_faults minus subset)
        for subset in subsets:
            if reruns_count >= max_reruns:
                break
            complement = [f for f in current_faults if f not in subset]
            if not complement:
                continue

            _, reproduces = evaluate_candidate(complement)
            if reproduces:
                current_faults = complement
                n = max(n - 1, 2)
                reduced = True
                break

        if reduced:
            continue

        # If cannot reduce further with current granularity, increase n
        if n < len(current_faults):
            n = min(len(current_faults), n * 2)
        else:
            # Cannot reduce further
            break

    return MinimalFaultSet(
        minimal_faults=current_faults,
        counterfactual_runs=counterfactual_runs,
        iterations_count=reruns_count,
        original_fault_count=len(original_schedule),
        minimal_fault_count=len(current_faults),
    )
