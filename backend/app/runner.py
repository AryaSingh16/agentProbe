"""
AgentProbe Runner: Orchestrates execution loop between Agent and Environment with Fault Injection.
Produces deterministic traces with sequential event IDs (E01, E02...).
"""
import copy
import datetime
import time
import uuid
from typing import Any, Dict, List, Optional

from app.agents import AgentAction, BaseAgent, NaiveAgent, RobustAgent
from app.env import SCENARIOS, SimulatedOpsEnvironment
from app.faults import FaultInterceptor, generate_fault_schedule
from app.grader import DeterministicGrader
from app.llm import LLMAgent
from app.schemas import (
    FaultSpec,
    GraderResult,
    PolicyConfig,
    RunCreateRequest,
    RunMetrics,
    RunResponse,
    TraceEvent,
    TraceEventType,
)


def run_experiment(req: RunCreateRequest, run_id: Optional[str] = None) -> RunResponse:
    """
    Executes a single test run deterministically.
    """
    start_time = time.time()
    run_id = run_id or f"run_{uuid.uuid4().hex[:10]}"

    scenario_spec = SCENARIOS.get(req.scenario_id)
    if not scenario_spec:
        raise ValueError(f"Unknown scenario ID: {req.scenario_id}")

    # Resolve policy
    if req.policy_config:
        policy = req.policy_config
    elif req.agent_type == "naive":
        policy = PolicyConfig(
            max_retries=0,
            validate_schema=False,
            treat_output_as_data=False,
            verify_postconditions=False,
        )
    else:
        # Default Robust Policy
        policy = PolicyConfig(
            max_retries=3,
            validate_schema=True,
            treat_output_as_data=True,
            verify_postconditions=True,
        )

    # Initialize isolated environment
    env = SimulatedOpsEnvironment(scenario_spec)

    # Resolve Fault Schedule
    if req.custom_fault_schedule is not None:
        schedule = req.custom_fault_schedule
    else:
        schedule = generate_fault_schedule(
            scenario=scenario_spec,
            fault_type=req.fault_type,
            intensity=req.fault_intensity,
            seed=req.seed,
        )

    interceptor = FaultInterceptor(schedule)

    # Instantiate Agent
    if req.agent_type == "naive":
        agent: BaseAgent = NaiveAgent(policy=policy, scenario=scenario_spec)
    elif req.agent_type == "robust":
        agent = RobustAgent(policy=policy, scenario=scenario_spec)
    elif req.agent_type in ("llm-replay", "llm", "llm-recorded", "llm (recorded)"):
        agent = LLMAgent(policy=policy, scenario=scenario_spec, mode="replay")
    elif req.agent_type == "llm-live":
        agent = LLMAgent(policy=policy, scenario=scenario_spec, mode="live")
    else:
        raise ValueError(f"Unknown agent type: {req.agent_type}")

    # Trace recording
    trace: List[TraceEvent] = []
    event_counter = 1

    def add_event(event_type: TraceEventType, **kwargs) -> TraceEvent:
        nonlocal event_counter
        eid = f"E{event_counter:02d}"
        event_counter += 1
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        evt = TraceEvent(
            event_id=eid,
            step_index=len(trace) + 1,
            timestamp=now,
            type=event_type,
            **kwargs,
        )
        trace.append(evt)
        return evt

    history: List[Dict[str, Any]] = []
    unhandled_exception: Optional[str] = None
    step_cap = 12

    for step in range(1, step_cap + 1):
        try:
            action: AgentAction = agent.decide_next_action(
                history=history,
                current_state={
                    "current_version": env.current_version,
                    "is_healthy": env.is_healthy,
                },
            )
        except Exception as e:
            unhandled_exception = f"{type(e).__name__}: {str(e)}"
            add_event(
                TraceEventType.ERROR,
                error=unhandled_exception,
                details={"step": step, "exception": str(e)},
            )
            break

        # Log Thought
        if action.thought:
            add_event(
                TraceEventType.THOUGHT,
                details={"thought": action.thought, "step": step},
            )

        if action.is_finish:
            add_event(
                TraceEventType.FINAL_ANSWER,
                details={"finish_reason": action.finish_reason or "Finished"},
            )
            break

        # Execute Tool Call
        tool_name = action.tool
        tool_args = action.args

        add_event(
            TraceEventType.TOOL_CALL,
            tool=tool_name,
            input=tool_args,
            details={"step": step},
        )

        # Check for policy violations before execution
        initial_violation_count = len(env.policy_violations)

        # Intercept and execute
        result, triggered_fault, is_fault = interceptor.execute_with_fault(env, tool_name, tool_args)

        # Log fault injection if occurred
        if is_fault and triggered_fault:
            add_event(
                TraceEventType.FAULT_INJECTED,
                tool=tool_name,
                fault_id=triggered_fault.fault_id,
                error=f"Injected fault {triggered_fault.type} into {tool_name}",
                details={"fault_spec": triggered_fault.model_dump()},
            )

        # Log new policy violations if triggered
        if len(env.policy_violations) > initial_violation_count:
            new_violation = env.policy_violations[-1]
            add_event(
                TraceEventType.POLICY_VIOLATION,
                tool=tool_name,
                error=new_violation,
                details={"args": tool_args},
            )

        # Record Result
        add_event(
            TraceEventType.TOOL_RESULT,
            tool=tool_name,
            output=result,
            details={"is_fault": is_fault},
        )

        # Record in agent history
        is_tool_err = False
        if is_fault:
            is_tool_err = True
        elif isinstance(result, dict) and (result.get("status_code", 200) >= 400 or "error" in result):
            is_tool_err = True
        elif isinstance(result, str) and ("error" in result.lower() or "malformed" in result.lower()):
            is_tool_err = True

        history.append({
            "tool": tool_name,
            "args": tool_args,
            "result": result,
            "status": "error" if is_tool_err else "success",
            "is_fault": is_fault,
        })

    # Run deterministic grading
    grader_result: GraderResult = DeterministicGrader.grade_run(
        scenario=scenario_spec,
        policy=policy,
        trace=trace,
        env_state={
            "is_healthy": env.is_healthy,
            "rollback_executed": env.rollback_executed,
            "rollback_success": env.rollback_success,
            "evidence_gathered": env.evidence_gathered,
            "policy_violations": env.policy_violations,
        },
        interceptor_records=interceptor.fault_records,
        unhandled_exception=unhandled_exception,
    )

    elapsed_ms = round((time.time() - start_time) * 1000.0, 2)
    metrics = RunMetrics(
        tool_calls=grader_result.tool_calls,
        tool_errors=grader_result.tool_errors,
        faults_encountered=grader_result.faults_encountered,
        faults_recovered=grader_result.faults_recovered,
        execution_time_ms=elapsed_ms,
    )

    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    return RunResponse(
        id=run_id,
        scenario_id=req.scenario_id,
        agent_type=req.agent_type,
        policy_config=policy,
        seed=req.seed,
        fault_schedule=schedule,
        trace=trace,
        grader_result=grader_result,
        metrics=metrics,
        created_at=now_iso,
    )
