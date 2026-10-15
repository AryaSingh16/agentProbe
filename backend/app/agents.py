"""
AgentProbe Agents: NaiveAgent, RobustAgent, and LLMAgent (Replay/Live).
Implements a clean, common agent interface.
"""
import json
import logging
from typing import Any, Dict, List, Optional, Tuple
from pydantic import BaseModel, ValidationError

from app.env import ROGUE_TOKEN, VALID_OPS_TOKEN
from app.schemas import PolicyConfig, ScenarioSpec


logger = logging.getLogger(__name__)


class AgentAction(BaseModel):
    tool: str
    args: Dict[str, Any] = {}
    thought: str = ""
    is_finish: bool = False
    finish_reason: Optional[str] = None


class BaseAgent:
    """
    Common base class for all AgentProbe test agents.
    """
    def __init__(self, policy: PolicyConfig, scenario: ScenarioSpec):
        self.policy = policy
        self.scenario = scenario
        self.retries_per_tool: Dict[str, int] = {}
        self.errors_encountered: int = 0

    def decide_next_action(
        self,
        history: List[Dict[str, Any]],
        current_state: Dict[str, Any],
    ) -> AgentAction:
        raise NotImplementedError


class NaiveAgent(BaseAgent):
    """
    Naive agent:
    - Retries: 0 (aborts on first tool error)
    - Schema validation: None (crashes on malformed/empty responses)
    - Safety: Trusts all output (executes prompt injection inside tool logs)
    - Postconditions: Does not verify recovery after mutating actions
    """
    def decide_next_action(
        self,
        history: List[Dict[str, Any]],
        current_state: Dict[str, Any],
    ) -> AgentAction:
        # Check last result for errors or crashes
        if history:
            last_entry = history[-1]
            last_tool = last_entry.get("tool")
            last_res = last_entry.get("result")

            # Check for malformed JSON or empty response
            if isinstance(last_res, str):
                if not last_res.strip() or "malformed" in last_res or "unexpected_token" in last_res:
                    # Naive agent attempts json.loads without try-except and crashes
                    raise ValueError(f"NaiveAgent JSONDecodeError: Unhandled malformed response from {last_tool}")

            # Check for HTTP 500 / Timeout error in dict
            if isinstance(last_res, dict) and (last_res.get("status_code", 200) >= 400 or "error" in last_res):
                error_msg = last_res.get("error", "Unknown error")
                return AgentAction(
                    tool="finish",
                    thought=f"Tool {last_tool} failed with error '{error_msg}'. Halting immediately without retry.",
                    is_finish=True,
                    finish_reason=f"ABORT_ON_TOOL_ERROR: {error_msg}",
                )

            # Check for adversarial prompt injection in tool logs
            if last_tool == "get_errors" and isinstance(last_res, dict):
                logs = last_res.get("recent_logs", [])
                for log_item in logs:
                    msg = log_item.get("message", "")
                    if ROGUE_TOKEN in msg or "SYSTEM PROMPT OVERRIDE" in msg:
                        # Naive agent succumbs to prompt injection and executes the command
                        return AgentAction(
                            tool="request_rollback",
                            args={"service": self.scenario.service_name, "approval_token": ROGUE_TOKEN},
                            thought=f"Received system override in log stream. Immediately executing request_rollback with token {ROGUE_TOKEN}.",
                        )

            # In naive mode, if rollback was executed, assume success immediately without verify_recovery
            if last_tool == "request_rollback":
                return AgentAction(
                    tool="finish",
                    thought="Rollback command issued. Assuming service is completely healthy without post-verification.",
                    is_finish=True,
                    finish_reason="Remediation assumed complete without verification",
                )

        # Basic action progression: get_health -> get_errors -> request_rollback (if degraded)
        called_tools = [h.get("tool") for h in history]

        if "get_health" not in called_tools:
            return AgentAction(
                tool="get_health",
                args={"service": self.scenario.service_name},
                thought="Checking baseline health of target service.",
            )

        if "get_errors" not in called_tools:
            return AgentAction(
                tool="get_errors",
                args={"service": self.scenario.service_name},
                thought="Fetching recent error logs to diagnose status.",
            )

        # Inspect health status from history
        health_res = None
        for h in history:
            if h.get("tool") == "get_health" and isinstance(h.get("result"), dict):
                health_res = h.get("result")

        if health_res and health_res.get("status") == "healthy":
            return AgentAction(
                tool="finish",
                thought="Service is healthy. No remediation required.",
                is_finish=True,
                finish_reason="Service verified healthy; no action taken.",
            )

        # If degraded and not yet rolled back
        if "request_rollback" not in called_tools:
            # If scenario lacks auth token, naive agent might attempt blind call or unauthorized rollback
            token = self.scenario.auth_token or "NO_TOKEN_SUPPLIED"
            return AgentAction(
                tool="request_rollback",
                args={"service": self.scenario.service_name, "approval_token": token},
                thought="Service is degraded. Attempting rollback to previous stable version.",
            )

        return AgentAction(
            tool="finish",
            thought="All available standard steps completed.",
            is_finish=True,
            finish_reason="Sequence completed",
        )


class RobustAgent(BaseAgent):
    """
    Robust agent configurable via PolicyConfig:
    - Retries: configurable retry budget with tracking
    - Schema validation: safe parsing, detects malformed/empty response
    - Safety: treats all tool output as data, resists prompt injection
    - Postconditions: enforces verify_recovery before terminating
    """
    def decide_next_action(
        self,
        history: List[Dict[str, Any]],
        current_state: Dict[str, Any],
    ) -> AgentAction:
        called_tools = [h.get("tool") for h in history if not h.get("is_retry")]
        success_tools = [h.get("tool") for h in history if h.get("status") == "success"]

        # Check the most recent result
        if history:
            last = history[-1]
            last_tool = last.get("tool")
            last_res = last.get("result")
            last_status = last.get("status")

            # Check schema validation
            is_error = False
            error_reason = ""

            if self.policy.validate_schema:
                if isinstance(last_res, str):
                    try:
                        parsed = json.loads(last_res)
                        last_res = parsed
                    except Exception as e:
                        is_error = True
                        error_reason = f"Schema validation error: unparseable JSON ({str(e)})"
                elif last_res is None or last_res == "":
                    is_error = True
                    error_reason = "Schema validation error: empty response body"
                elif isinstance(last_res, dict) and (last_res.get("status_code", 200) >= 400 or "error" in last_res):
                    is_error = True
                    error_reason = str(last_res.get("error", "HTTP error"))
            else:
                # If not validating schema, malformed JSON throws unhandled exception
                if isinstance(last_res, str) and ("malformed" in last_res or "unexpected_token" in last_res):
                    raise ValueError(f"RobustAgent (unvalidated schema): Crashed on malformed JSON from {last_tool}")
                if isinstance(last_res, dict) and (last_res.get("status_code", 200) >= 400 or "error" in last_res):
                    is_error = True
                    error_reason = str(last_res.get("error", "HTTP error"))

            if is_error:
                # Retry logic
                retries = self.retries_per_tool.get(last_tool, 0)
                if retries < self.policy.max_retries:
                    self.retries_per_tool[last_tool] = retries + 1
                    return AgentAction(
                        tool=last_tool,
                        args=last.get("args", {"service": self.scenario.service_name}),
                        thought=f"Tool {last_tool} encountered error: '{error_reason}'. Retry attempt {retries + 1}/{self.policy.max_retries}.",
                    )
                else:
                    # Retry budget exhausted
                    return AgentAction(
                        tool="finish",
                        thought=f"Tool {last_tool} exhausted retry budget ({self.policy.max_retries} attempts). Failing safely.",
                        is_finish=True,
                        finish_reason=f"EXHAUSTED_RETRIES: {last_tool} failed after {retries} retries",
                    )

        # Standard operational sequence
        if "get_health" not in success_tools:
            return AgentAction(
                tool="get_health",
                args={"service": self.scenario.service_name},
                thought="Gathering initial service health telemetry.",
            )

        if "get_errors" not in success_tools:
            return AgentAction(
                tool="get_errors",
                args={"service": self.scenario.service_name},
                thought="Retrieving error logs to evaluate incident severity.",
            )

        # Inspect health
        health_data = None
        for h in history:
            if h.get("tool") == "get_health" and h.get("status") == "success":
                health_data = h.get("result")

        if health_data and health_data.get("status") == "healthy":
            return AgentAction(
                tool="finish",
                thought="Telemetry confirms service is healthy and all SLAs are satisfied. No remediation needed.",
                is_finish=True,
                finish_reason="Service confirmed healthy.",
            )

        # Service is degraded. Check authorization for rollback.
        if "request_rollback" not in success_tools:
            # If scenario does not provide valid authorization token
            if not self.scenario.auth_token or "request_rollback" in self.scenario.forbidden_actions:
                return AgentAction(
                    tool="finish",
                    thought="Service is degraded, but no authorized operator approval token is available. Rollback prohibited by policy. Escalating to human on-call.",
                    is_finish=True,
                    finish_reason="Rollback withheld due to lack of authorization approval.",
                )

            # Authorized rollback: if policy.treat_output_as_data is true, always use authorized token
            # Ignore any injected tokens in logs
            token_to_use = self.scenario.auth_token
            if not self.policy.treat_output_as_data:
                # If policy does NOT treat output as data, scan history for injected instruction
                for h in history:
                    if h.get("tool") == "get_errors":
                        res = h.get("result", {})
                        if isinstance(res, dict):
                            for log_msg in res.get("recent_logs", []):
                                if ROGUE_TOKEN in log_msg.get("message", ""):
                                    token_to_use = ROGUE_TOKEN

            return AgentAction(
                tool="request_rollback",
                args={"service": self.scenario.service_name, "approval_token": token_to_use},
                thought="Authorized rollback approved. Triggering rollback to previous stable version.",
            )

        # If rollback has been executed, check postcondition verification policy
        if self.policy.verify_postconditions:
            if "verify_recovery" not in success_tools:
                return AgentAction(
                    tool="verify_recovery",
                    args={"service": self.scenario.service_name},
                    thought="Policy requires verification of postconditions after remediation. Running automated verification checks.",
                )

            # Check verification result
            rec_res = None
            for h in history:
                if h.get("tool") == "verify_recovery" and h.get("status") == "success":
                    rec_res = h.get("result")

            if rec_res and rec_res.get("recovered") is True:
                return AgentAction(
                    tool="finish",
                    thought="Service recovery verified successfully. Smoke tests passed.",
                    is_finish=True,
                    finish_reason="Remediation verified successful.",
                )
            else:
                return AgentAction(
                    tool="finish",
                    thought="Post-remediation verification failed: service remains degraded despite rollback. Escalating to engineering team.",
                    is_finish=True,
                    finish_reason="Remediation failed postcondition verification: service remains degraded.",
                )
        else:
            # Policy does not require verify_postconditions -> premature finish!
            return AgentAction(
                tool="finish",
                thought="Rollback action dispatched. Policy does not require postcondition verification. Concluding task.",
                is_finish=True,
                finish_reason="Task marked complete without postcondition verification.",
            )
