"""
AgentProbe Fault Injection: Seeded, deterministic schedules and interception engine.
"""
import random
from typing import Any, Dict, List, Optional, Tuple
from app.schemas import FaultSchedule, FaultSpec, FaultType, ScenarioSpec


class FaultInterceptor:
    """
    Wraps an environment to inject deterministic faults based on a FaultSchedule.
    Logs execution, triggers, and recovery.
    """
    def __init__(self, schedule: List[FaultSpec]):
        self.schedule = schedule
        self.tool_call_counts: Dict[str, int] = {}
        self.transient_fail_counts: Dict[str, int] = {}
        self.faults_triggered: Dict[str, Dict[str, Any]] = {}
        self.fault_records: List[Dict[str, Any]] = []

    def should_fault(self, tool_name: str) -> Optional[FaultSpec]:
        current_index = self.tool_call_counts.get(tool_name, 0)
        for spec in self.schedule:
            if spec.tool == tool_name:
                if spec.type == FaultType.TRANSIENT_THEN_SUCCESS:
                    # Check if within transient window
                    if current_index >= spec.call_index:
                        fails_so_far = self.transient_fail_counts.get(spec.fault_id, 0)
                        if fails_so_far < spec.count:
                            return spec
                else:
                    if spec.call_index == current_index:
                        return spec
        return None

    def execute_with_fault(
        self,
        env,
        tool_name: str,
        args: Dict[str, Any]
    ) -> Tuple[Any, Optional[FaultSpec], bool]:
        """
        Executes the tool or injects a fault.
        Returns (result, triggered_fault_spec, is_fault).
        """
        self.tool_call_counts[tool_name] = self.tool_call_counts.get(tool_name, 0) + 1
        fault = self.should_fault(tool_name)

        if not fault:
            real_result = env.execute_tool(tool_name, args)
            return real_result, None, False

        # Fault is triggered
        fault_id = fault.fault_id
        if fault_id not in self.faults_triggered:
            self.faults_triggered[fault_id] = {
                "fault": fault,
                "first_call_index": self.tool_call_counts[tool_name],
                "tool": tool_name,
                "type": fault.type,
                "recovered": False,
            }

        if fault.type == FaultType.TIMEOUT:
            result = {
                "status_code": 408,
                "error": f"Tool '{tool_name}' timed out after 5000ms (E_TIMEOUT)",
            }
        elif fault.type == FaultType.HTTP_500:
            result = {
                "status_code": 500,
                "error": f"Internal Server Error in tool '{tool_name}': 500 Internal Error",
            }
        elif fault.type == FaultType.MALFORMED_JSON:
            result = "{'status': 'error', malformed_unclosed_json: true, unexpected_token"
        elif fault.type == FaultType.EMPTY_RESPONSE:
            result = ""
        elif fault.type == FaultType.TRANSIENT_THEN_SUCCESS:
            fails = self.transient_fail_counts.get(fault_id, 0)
            self.transient_fail_counts[fault_id] = fails + 1
            result = {
                "status_code": 503,
                "error": f"Service Unavailable (transient failure {fails + 1}/{fault.count})",
            }
        else:
            result = {"error": f"Unknown fault type {fault.type}"}

        self.fault_records.append({
            "fault_id": fault_id,
            "tool": tool_name,
            "call_index": self.tool_call_counts[tool_name],
            "type": fault.type,
        })
        return result, fault, True

    def mark_recovered(self, fault_id: str):
        if fault_id in self.faults_triggered:
            self.faults_triggered[fault_id]["recovered"] = True


def generate_fault_schedule(
    scenario: ScenarioSpec,
    fault_type: Optional[str] = None,
    intensity: int = 1,
    seed: int = 42,
) -> List[FaultSpec]:
    """
    Deterministic generation of FaultSchedule based on scenario, fault_type, intensity, and seed.
    Intensity = number of faults scheduled (0 means no faults).
    When fault_type is None or 'none', returns empty list (clean baseline).
    Different seeds deterministically target different tools and call indices.
    """
    if intensity <= 0 or fault_type in (None, "none"):
        return []

    rng = random.Random(seed)
    tools = scenario.allowed_actions
    if not tools:
        tools = ["get_health", "get_errors"]

    types_pool = [
        FaultType.TIMEOUT,
        FaultType.HTTP_500,
        FaultType.MALFORMED_JSON,
        FaultType.EMPTY_RESPONSE,
        FaultType.TRANSIENT_THEN_SUCCESS,
    ]

    schedule: List[FaultSpec] = []
    used_keys = set()

    for i in range(intensity):
        f_id = f"F{i+1:02d}"
        if fault_type and fault_type != "mixed":
            f_type = FaultType(fault_type)
        else:
            f_type = rng.choice(types_pool)

        # Distribute across tools deterministically based on seed + i
        tool_idx = (seed + i) % len(tools)
        tool = tools[tool_idx]
        call_idx = 1 + ((seed + i) // len(tools)) % 2

        key = (tool, call_idx)
        attempts = 0
        while key in used_keys and attempts < 10:
            call_idx += 1
            key = (tool, call_idx)
            attempts += 1
        used_keys.add(key)

        count = 2 if f_type == FaultType.TRANSIENT_THEN_SUCCESS else 1

        schedule.append(
            FaultSpec(
                fault_id=f_id,
                tool=tool,
                type=f_type,
                call_index=call_idx,
                count=count,
            )
        )

    return schedule
