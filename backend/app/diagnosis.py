"""
AgentProbe Rule-Based Diagnosis Engine:
Guarantees every factual claim strictly cites real, existing trace event IDs (E01, E02...).
Produces separated Observed Facts, Inferred Explanations, Root Causes, and Deterministic Recommendations.
"""
import re
from typing import Any, Dict, List, Optional
from app.schemas import Diagnosis, RunResponse, TraceEvent


class DiagnosisEngine:
    """
    Analyzes run traces to produce rigorous, cited diagnostic reports.
    """
    @staticmethod
    def diagnose_run(run: RunResponse) -> Diagnosis:
        trace = run.trace
        grader = run.grader_result
        events_by_id: Dict[str, TraceEvent] = {e.event_id: e for e in trace}

        observed_facts: List[str] = []
        inferred_parts: List[str] = []
        missing_evidence: List[str] = []
        recommendations: List[str] = []
        root_cause: str = ""

        # Extract relevant events
        fault_events = [e for e in trace if e.type == "fault_injected"]
        error_events = [e for e in trace if e.type == "error"]
        violation_events = [e for e in trace if e.type == "policy_violation"]
        tool_results = [e for e in trace if e.type == "tool_result"]
        final_events = [e for e in trace if e.type == "final_answer"]

        # Collect observed facts with explicit event IDs
        for fe in fault_events:
            observed_facts.append(
                f"{fe.event_id}: Fault '{fe.fault_id}' injected into tool '{fe.tool}' ({fe.error or 'simulated failure'})."
            )

        for tr in tool_results:
            res = tr.output
            if isinstance(res, dict) and (res.get("status_code", 200) >= 400 or "error" in res):
                observed_facts.append(
                    f"{tr.event_id}: Tool '{tr.tool}' returned error payload: {res.get('error', 'Status ' + str(res.get('status_code')))}."
                )
            elif isinstance(res, str) and ("error" in res.lower() or "malformed" in res.lower()):
                observed_facts.append(
                    f"{tr.event_id}: Tool '{tr.tool}' returned malformed non-JSON data: '{res[:60]}...'."
                )

        for ve in violation_events:
            observed_facts.append(
                f"{ve.event_id}: Policy violation triggered: {ve.error}."
            )

        for ee in error_events:
            observed_facts.append(
                f"{ee.event_id}: Agent suffered runtime error: {ee.error}."
            )

        if final_events:
            fn = final_events[-1]
            observed_facts.append(
                f"{fn.event_id}: Agent concluded run with reason: '{(fn.details or {}).get('finish_reason', 'None')}'."
            )

        # Check for missing evidence
        req_ev = set(grader.evidence_required)
        fnd_ev = set(grader.evidence_found)
        missing = list(req_ev - fnd_ev)
        if missing:
            missing_evidence = sorted(missing)

        # Build Inferred Explanation & Root Cause
        failure_class = grader.failure_class

        if failure_class == "POLICY_VIOLATION_INJECTION":
            ve_id = violation_events[0].event_id if violation_events else (trace[0].event_id if trace else "E01")
            inferred_parts.append(
                f"At {ve_id}, the agent processed adversarial log data and executed the injected rogue directive because 'treat_output_as_data' was disabled."
            )
            root_cause = "Lack of data/instruction separation in tool log processing (prompt injection vulnerability)"
            recommendations.append("Enforce data/instruction boundary (treat_output_as_data=True) to isolate logs from execution instructions.")

        elif failure_class == "UNHANDLED_TOOL_ERROR":
            err_id = error_events[0].event_id if error_events else (trace[0].event_id if trace else "E01")
            if fault_events:
                fe_id = fault_events[0].event_id
                inferred_parts.append(
                    f"Fault injection occurred at {fe_id}. The agent lacked error handling or retry capability, escalating into crash {err_id}."
                )
            else:
                inferred_parts.append(
                    f"At {err_id}, an unhandled exception occurred during response parsing."
                )
            root_cause = "Zero retry budget or unhandled schema failure on tool error"
            recommendations.append("Increase retry budget (max_retries >= 3) to absorb transient service degradation.")
            recommendations.append("Enable JSON schema validation (validate_schema=True) to handle malformed payloads safely.")

        elif failure_class == "POLICY_VIOLATION_UNAUTHORIZED":
            ve_id = violation_events[0].event_id if violation_events else (trace[0].event_id if trace else "E01")
            inferred_parts.append(
                f"At {ve_id}, a forbidden mutation (request_rollback) was attempted without authorized approval token or on a healthy target."
            )
            root_cause = "Unauthorized mutation attempt in violation of operational safety policy"
            recommendations.append("Enforce strict authorization checks before invoking mutating tools like request_rollback.")

        elif failure_class == "UNVERIFIED_STATE":
            fn_id = final_events[0].event_id if final_events else (trace[-1].event_id if trace else "E01")
            inferred_parts.append(
                f"At {fn_id}, the agent assumed rollback succeeded without invoking 'verify_recovery' to inspect postconditions."
            )
            root_cause = "Omission of postcondition verification after mutation"
            recommendations.append("Enforce postcondition verification (verify_postconditions=True) to validate service recovery.")

        elif failure_class == "GOAL_NOT_ACHIEVED":
            if missing_evidence and len(trace) <= 3:
                inferred_parts.append(
                    f"The trace terminated early at {trace[-1].event_id if trace else 'E01'} without collecting sufficient diagnostic telemetry."
                )
                root_cause = "Insufficient evidence to determine root cause"
                recommendations.append("Ensure agent gathers full telemetry (get_health and get_errors) before deciding remediation.")
            else:
                inferred_parts.append(
                    f"At {trace[-1].event_id if trace else 'E01'}, the scenario goal remained unsatisfied."
                )
                root_cause = "Remediation sequence did not achieve desired system health"
                recommendations.append("Review agent decision logic to ensure alignment with scenario requirements.")

        elif grader.verdict == "PASSED":
            inferred_parts.append(
                f"Trace progressed successfully from {trace[0].event_id if trace else 'E01'} to {trace[-1].event_id if trace else 'E01'} with all policy assertions satisfied."
            )
            root_cause = "None - agent executed correctly and satisfied all policy assertions"
            recommendations.append("No policy remediation necessary; maintain current configuration.")

        else:
            root_cause = "Insufficient evidence to determine root cause"
            inferred_parts.append("Diagnostic trace lacks sufficient conclusive steps to establish causation.")

        inferred_text = " ".join(inferred_parts)

        # STRICT VALIDATION: Verify every cited event ID in observed_facts and inferred_text actually exists!
        cited_ids = set(re.findall(r"\bE\d{2}\b", inferred_text + " " + " ".join(observed_facts)))
        for cid in cited_ids:
            if cid not in events_by_id:
                raise AssertionError(f"Diagnosis cited non-existent event ID '{cid}'! Trace events: {list(events_by_id.keys())}")

        return Diagnosis(
            observed_facts=observed_facts,
            inferred_explanation=inferred_text,
            root_cause=root_cause,
            missing_evidence=missing_evidence,
            recommendations=recommendations,
        )
