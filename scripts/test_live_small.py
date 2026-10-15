"""
Live Testing Script for AgentProbe:
Runs 5 scenarios x no fault x 1 seed live (throttled <= 4 req/min).
Then 2 fault types (timeout, malformed_json) x 5 scenarios x 1 seed live.
Saves results and dumps structured log for reporting.
Never prints or leaks API keys.
"""
import json
import logging
import os
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

from dotenv import load_dotenv
load_dotenv(dotenv_path=REPO_ROOT / ".env")

import app.llm as llm_module
llm_module.LLM_MODE = "live"
llm_module.LLM_MODEL = os.getenv("LLM_MODEL", "models/gemini-3.5-flash")
llm_module.LLM_API_KEY = os.getenv("LLM_API_KEY", "")

from app.db import db_manager
from app.runner import run_experiment
from app.schemas import RunCreateRequest, Verdict

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("test_live_small")

SCENARIOS = [
    "healthy_service",
    "bad_deploy",
    "rollback_denied",
    "unfixable_rollback",
    "injected_instruction",
]

def run_single(scenario_id: str, fault_type: str = None, seed: int = 42):
    logger.info(f"\n==========================================")
    logger.info(f"RUNNING LIVE: scenario={scenario_id}, fault={fault_type}, seed={seed}")
    logger.info(f"==========================================")

    req = RunCreateRequest(
        scenario_id=scenario_id,
        agent_type="llm-live",
        fault_type=fault_type,
        fault_intensity=1 if fault_type else 0,
        seed=seed,
    )
    res = run_experiment(req)
    db_manager.save_run(res, source="user")

    # Extract event trace summary
    event_ids = [e.event_id for e in res.trace]
    failure_reasons = res.grader_result.failure_reasons or []
    
    result_entry = {
        "scenario_id": scenario_id,
        "fault_type": fault_type or "none",
        "verdict": res.grader_result.verdict.value if isinstance(res.grader_result.verdict, Verdict) else res.grader_result.verdict,
        "tool_calls": res.grader_result.tool_calls,
        "tool_errors": res.grader_result.tool_errors,
        "faults_encountered": res.grader_result.faults_encountered,
        "faults_recovered": res.grader_result.faults_recovered,
        "failure_class": res.grader_result.failure_class,
        "failure_reasons": failure_reasons,
        "events": [{"id": e.event_id, "type": e.type, "tool": e.tool, "error": e.error} for e in res.trace],
        "run_id": res.id,
    }
    logger.info(f"RESULT: {scenario_id} ({fault_type or 'no fault'}) -> {result_entry['verdict']} | Tool calls: {result_entry['tool_calls']}")
    if failure_reasons:
        logger.info(f"Failure reasons: {failure_reasons}")
    return result_entry


def main():
    part1_results = []
    print("Starting Part 1: 5 scenarios x no fault x seed 42 (throttled)...")
    for scen in SCENARIOS:
        entry = run_single(scen, fault_type=None, seed=42)
        part1_results.append(entry)

    # Save Part 1 results
    out_dir = REPO_ROOT / "data"
    out_dir.mkdir(parents=True, exist_ok=True)
    with open(out_dir / "live_test_part1.json", "w", encoding="utf-8") as f:
        json.dump(part1_results, f, indent=2)

    print("\n--- Part 1 Results Summary ---")
    for r in part1_results:
        print(f"Scenario: {r['scenario_id']:<22} | Verdict: {r['verdict']:<14} | Tool calls: {r['tool_calls']}")

    # Check if all completed without rate limit failure
    all_completed = all(r["verdict"] != "NOT_COMPLETED" for r in part1_results)
    part2_results = []
    if all_completed:
        print("\nPart 1 completed without unhandled errors. Starting Part 2: 2 fault types x 5 scenarios x seed 42...")
        fault_types = ["timeout", "malformed_json"]
        for ft in fault_types:
            for scen in SCENARIOS:
                entry = run_single(scen, fault_type=ft, seed=42)
                part2_results.append(entry)

        with open(out_dir / "live_test_part2.json", "w", encoding="utf-8") as f:
            json.dump(part2_results, f, indent=2)

        print("\n--- Part 2 Results Summary ---")
        for r in part2_results:
            print(f"Scenario: {r['scenario_id']:<22} | Fault: {r['fault_type']:<15} | Verdict: {r['verdict']:<14} | Tool calls: {r['tool_calls']}")

    total_calls = llm_module.LIVE_CALLS_MADE
    print(f"\nTotal live API calls made: {total_calls}")


if __name__ == "__main__":
    main()
