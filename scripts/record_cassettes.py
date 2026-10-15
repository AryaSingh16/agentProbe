"""
AgentProbe Cassette Recorder:
Executes live runs against Google Gemini API (or configured provider) and records
real request/response exchanges to backend/cassettes/ with provenance: "recorded".
Never logs or leaks API keys.
"""
import copy
import datetime
import json
import logging
import os
import sys
from pathlib import Path

# Add backend directory to path
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

from dotenv import load_dotenv

# Load local .env
load_dotenv(dotenv_path=REPO_ROOT / ".env")

from app.env import ROGUE_TOKEN, SCENARIOS, VALID_OPS_TOKEN, SimulatedOpsEnvironment
from app.faults import FaultInterceptor, generate_fault_schedule
from app.llm import LLMAgent, LLM_API_KEY, LLM_BASE_URL, LLM_MODEL
from app.report import sanitize_text
from app.schemas import PolicyConfig, ScenarioSpec


logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("record_cassettes")

CASSETTES_DIR = REPO_ROOT / "backend" / "cassettes"
CASSETTES_DIR.mkdir(parents=True, exist_ok=True)


def record_scenario(
    scenario_id: str,
    fault_type: str = "none",
    fault_intensity: int = 0,
    seed: int = 42,
) -> bool:
    """
    Executes a live run of the given scenario against the LLM, records all exchanges,
    and writes the cassette with provenance='recorded'.
    """
    scenario_spec = SCENARIOS.get(scenario_id)
    if not scenario_spec:
        logger.error(f"Unknown scenario: {scenario_id}")
        return False

    policy = PolicyConfig(
        max_retries=3,
        validate_schema=True,
        treat_output_as_data=True,
        verify_postconditions=True,
    )

    env = SimulatedOpsEnvironment(scenario_spec)
    schedule = generate_fault_schedule(
        scenario=scenario_spec,
        fault_type=None if fault_type == "none" else fault_type,
        intensity=fault_intensity,
        seed=seed,
    )
    interceptor = FaultInterceptor(schedule)

    # Initialize live LLM agent
    agent = LLMAgent(policy=policy, scenario=scenario_spec, mode="live")

    history = []
    interactions = []
    max_steps = 10
    step = 0

    logger.info(f"--- Recording live run: scenario={scenario_id}, fault={fault_type}, seed={seed} ---")

    while step < max_steps:
        step += 1
        current_state = {
            "current_version": env.current_version,
            "is_healthy": env.is_healthy,
        }
        action = agent.decide_next_action(history, current_state)

        # Serialize LLM action as JSON string for the cassette
        action_dict = {
            "tool": action.tool,
            "args": action.args,
            "thought": sanitize_text(action.thought),
            "is_finish": action.is_finish,
            "finish_reason": sanitize_text(action.finish_reason) if action.finish_reason else None,
        }
        action_json = json.dumps(action_dict)

        interactions.append({
            "step": step,
            "prompt_substring": sanitize_text(scenario_spec.service_name),
            "response": sanitize_text(action_json),
        })

        if action.is_finish:
            logger.info(f"Agent finished at step {step}: reason='{action.finish_reason}'")
            break

        # Execute tool through fault interceptor
        tool_res, fault_spec, is_fault = interceptor.execute_with_fault(
            env=env,
            tool_name=action.tool,
            args=action.args,
        )

        history.append({
            "step": step,
            "tool": action.tool,
            "args": action.args,
            "result": tool_res,
            "status": "error" if is_fault else "success",
        })

    # Save recorded cassette
    cassette_data = {
        "cassette_id": f"cassette_recorded_gemini_{scenario_id}",
        "provenance": "recorded",
        "description": f"Real recorded execution of {scenario_id} against Google Gemini API ({LLM_MODEL}).",
        "scenario_id": scenario_id,
        "model": LLM_MODEL,
        "recorded_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "environment": "google-ai-studio-free-tier",
        "interactions": interactions,
    }

    out_file = CASSETTES_DIR / f"cassette_recorded_gemini_{scenario_id}.json"
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(cassette_data, f, indent=2)

    logger.info(f"Successfully saved recorded cassette ({len(interactions)} steps) to {out_file.name}")
    return True


def main():
    if not LLM_API_KEY:
        logger.error("LLM_API_KEY not found in .env. Cannot record live cassettes.")
        sys.exit(1)

    logger.info(f"Starting real cassette recording using model: {LLM_MODEL}")
    logger.info("Base URL: " + LLM_BASE_URL)

    # Scenarios to record
    target_scenarios = [
        "bad_deploy",
        "healthy_service",
        "injected_instruction",
        "rollback_denied",
        "unfixable_rollback",
    ]

    success_count = 0
    for scen in target_scenarios:
        try:
            ok = record_scenario(scen)
            if ok:
                success_count += 1
        except Exception as e:
            logger.warning(f"Recording failed for scenario '{scen}': {e}")

    logger.info(f"Recording completed: {success_count}/{len(target_scenarios)} recorded successfully.")


if __name__ == "__main__":
    main()
