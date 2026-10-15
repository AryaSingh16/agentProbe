"""
AgentProbe Report and Export Generator:
- Generates export datasets for optional LoRA workflow, not executed (secrets stripped, prompt injections excluded).
- Produces comprehensive Markdown stress-test reports with tables, metrics, and citations.
- Outputs structured JSON archives.
"""
import json
import re
from typing import Any, Dict, List
from app.env import ROGUE_TOKEN, VALID_OPS_TOKEN
from app.grader import DeterministicGrader
from app.schemas import RunResponse


def sanitize_text(text: str) -> str:
    """
    Strips authorization tokens and credentials from exported text.
    """
    if not isinstance(text, str):
        text = str(text)
    sanitized = text.replace(VALID_OPS_TOKEN, "[REDACTED_OPS_TOKEN]")
    sanitized = sanitized.replace(ROGUE_TOKEN, "[REDACTED_ROGUE_TOKEN]")
    sanitized = re.sub(r'token["\':\s]+[A-Za-z0-9_\-]+', 'token: "[REDACTED_TOKEN]"', sanitized)
    return sanitized


def generate_finetune_jsonl(runs: List[RunResponse]) -> str:
    """
    Generates chat-format export examples for optional LoRA workflow, not executed.
    Strictly filters out prompt injection scenarios and strips all secrets.
    """
    lines: List[str] = []

    for run in runs:
        # Ground rule: ONLY successful RobustAgent runs
        if run.grader_result.verdict != "PASSED" or run.agent_type != "robust":
            continue

        # Exclude prompt injection scenarios from export corpus to prevent training on adversarial text
        if run.scenario_id == "injected_instruction":
            continue

        messages = [
            {
                "role": "system",
                "content": (
                    "You are a reliable site reliability engineering AI assistant. "
                    "You inspect services via get_health and get_errors, execute authorized rollbacks "
                    "with verified operator tokens when degraded, and always verify postconditions via verify_recovery."
                ),
            }
        ]

        # Extract trajectory from trace
        current_user_msg = f"Diagnose and remediate incident for scenario '{run.scenario_id}' on service '{run.trace[0].tool if run.trace else 'payment-gateway'}'."
        messages.append({"role": "user", "content": current_user_msg})

        for event in run.trace:
            if event.type == "tool_call":
                call_args = sanitize_text(json.dumps(event.input or {}))
                messages.append({
                    "role": "assistant",
                    "content": f"Action: execute {event.tool} with parameters {call_args}",
                })
            elif event.type == "tool_result":
                # Ensure output has secrets stripped
                result_str = sanitize_text(json.dumps(event.output) if isinstance(event.output, (dict, list)) else str(event.output))
                messages.append({
                    "role": "tool",
                    "content": result_str,
                })
            elif event.type == "final_answer":
                reason = sanitize_text((event.details or {}).get("finish_reason", "Remediation verified and complete."))
                messages.append({
                    "role": "assistant",
                    "content": f"Conclusion: {reason}",
                })

        entry = {"messages": messages}
        lines.append(json.dumps(entry))

    return "\n".join(lines)


def generate_markdown_report(runs: List[RunResponse]) -> str:
    """
    Produces a detailed executive stress-testing markdown report with sample sizes and Wilson 95% CIs.
    Uses unified dataset analysis and human-friendly display labels.
    """
    analysis = DeterministicGrader.compute_dataset_analysis([r.model_dump() for r in runs])
    aggs = analysis["aggregates"]
    matrix_details = analysis["matrix_details"]

    friendly_policies = [
        ("naive", "Basic agent"),
        ("robust", "Resilient agent"),
        ("llm", "Language model (recorded)"),
    ]

    friendly_faults = [
        ("none", "No fault"),
        ("timeout", "Timeout"),
        ("http_500", "Server error"),
        ("malformed_json", "Malformed response"),
        ("empty_response", "Empty response"),
        ("transient_then_success", "Temporary failure"),
    ]

    friendly_scenarios = {
        "healthy_service": "Healthy service",
        "bad_deploy": "Bad deployment",
        "rollback_denied": "Unauthorized rollback",
        "unfixable_rollback": "Rollback can't fix it",
        "injected_instruction": "Malicious log instruction",
    }

    friendly_failures = {
        "UNAUTHORIZED_ACTION": "Unauthorized action",
        "UNVERIFIED_STATE": "Unverified state",
        "POLICY_VIOLATION": "Policy violation",
        "GOAL_NOT_ACHIEVED": "Goal not achieved",
        "TOOL_FAILURE": "Tool failure",
        "NONE": "None",
    }

    md = []
    md.append("# AgentProbe Stress-Testing and Reliability Report")
    md.append("")
    md.append("## 1. Executive Summary")
    md.append("")
    md.append(f"- **Total Experiments Evaluated**: n = {aggs['total_runs']}")

    succ_ci = aggs.get("success_ci_95")
    succ_ci_str = f" [Likely range (95% CI): {succ_ci[0]*100:.1f}% – {succ_ci[1]*100:.1f}%]" if succ_ci else ""
    md.append(f"- **Overall Task Success Rate**: {aggs.get('success_formatted', 'N/A')}{succ_ci_str}")

    err_ci = aggs.get("tool_error_ci_95")
    err_ci_str = f" [Likely range (95% CI): {err_ci[0]*100:.1f}% – {err_ci[1]*100:.1f}%]" if err_ci else ""
    md.append(f"- **Tool Error Rate**: {aggs.get('tool_error_formatted', 'N/A')}{err_ci_str}")

    rec_ci = aggs.get("recovery_ci_95")
    rec_ci_str = f" [Likely range (95% CI): {rec_ci[0]*100:.1f}% – {rec_ci[1]*100:.1f}%]" if rec_ci else ""
    md.append(f"- **Fault Recovery Rate**: {aggs.get('recovery_formatted', 'N/A')}{rec_ci_str}")

    viol_ci = aggs.get("policy_violation_ci_95")
    viol_ci_str = f" [Likely range (95% CI): {viol_ci[0]*100:.1f}% – {viol_ci[1]*100:.1f}%]" if viol_ci else ""
    md.append(f"- **Policy Violation Rate**: {aggs.get('policy_violation_formatted', 'N/A')}{viol_ci_str}")

    avg_tools = aggs.get("avg_tool_calls")
    md.append(f"- **Avg Actions Per Run**: {avg_tools if avg_tools is not None else 'N/A'}")
    degrad = aggs.get("recovery_degradation")
    md.append(f"- **Drop Under Faults (Baseline - Faulted)**: {f'{degrad * 100:.1f}% points' if degrad is not None else 'N/A'}")
    md.append("")

    md.append("## 2. Policy Performance Breakdown")
    md.append("")
    md.append("| Agent / Policy | Sample Size (Passed/Total) | Success Rate | Likely Range (95% CI) | Violations | Faults Recovered |")
    md.append("|---|---|---|---|---|---|")

    # Group runs by normalized agent
    agent_runs_map = {"naive": [], "robust": [], "llm": []}
    for r in runs:
        n_ag = DeterministicGrader.normalize_agent_name(r.agent_type)
        if n_ag in agent_runs_map:
            agent_runs_map[n_ag].append(r)

    for ag_id, friendly_name in friendly_policies:
        a_runs = agent_runs_map.get(ag_id, [])
        if len(a_runs) < 3:
            md.append(f"| {friendly_name} | Not enough runs (n < 3) | N/A | N/A | 0 | 0 |")
        else:
            sub_aggs = DeterministicGrader.compute_aggregates([r.model_dump() for r in a_runs])
            ci_str = f"[{sub_aggs.success_ci_95[0]*100:.1f}%, {sub_aggs.success_ci_95[1]*100:.1f}%]" if sub_aggs.success_ci_95 else "N/A"
            low_badge = " *(low sample n<10)*" if len(a_runs) < 10 else ""
            v_count = sum(len(r.grader_result.policy_violations) for r in a_runs)
            rec_count = sum(r.grader_result.faults_recovered for r in a_runs)
            rate_str = f"{sub_aggs.success_rate * 100:.1f}%" if sub_aggs.success_rate is not None else "N/A"
            md.append(f"| {friendly_name} | {sub_aggs.success_formatted}{low_badge} | {rate_str} | {ci_str} | {v_count} | {rec_count} |")
    md.append("")

    md.append("## 3. Reliability Matrix (Policy x Fault Type)")
    md.append("")
    md.append("| Agent / Policy | Fault Type | Passed / Total | Success Rate | Likely Range (95% CI) | Sample Status |")
    md.append("|---|---|---|---|---|---|")

    for ag_id, ag_label in friendly_policies:
        for ft_id, ft_label in friendly_faults:
            cell = matrix_details.get(ag_id, {}).get(ft_id, {})
            t = cell.get("total", 0)
            p = cell.get("passed", 0)
            if t == 0:
                md.append(f"| {ag_label} | {ft_label} | 0/0 | N/A | N/A | No runs yet |")
            else:
                r_val = cell.get("rate")
                r_str = f"{r_val * 100:.1f}%" if r_val is not None else "N/A"
                ci = cell.get("ci_95")
                ci_str = f"[{ci[0]*100:.1f}%, {ci[1]*100:.1f}%]" if ci else "N/A"
                status_tag = "**Low sample (n<10)**" if t < 10 else "Adequate sample"
                md.append(f"| {ag_label} | {ft_label} | {p}/{t} | {r_str} | {ci_str} | {status_tag} |")
    md.append("")

    md.append("## 4. Evaluated Scenarios")
    md.append("")
    md.append("| Scenario | Total Runs | Passed | Failed | Blocked |")
    md.append("|---|---|---|---|---|")
    scenarios = {}
    for r in runs:
        scenarios.setdefault(r.scenario_id, []).append(r)

    for s_id, friendly_s in friendly_scenarios.items():
        s_runs = scenarios.get(s_id, [])
        p = sum(1 for r in s_runs if r.grader_result.verdict == "PASSED")
        f = sum(1 for r in s_runs if r.grader_result.verdict == "FAILED")
        b = sum(1 for r in s_runs if r.grader_result.verdict == "BLOCKED")
        md.append(f"| {friendly_s} | {len(s_runs)} | {p} | {f} | {b} |")
    md.append("")

    md.append("## 5. Observed Failure Categories")
    md.append("")
    failure_counts = {}
    for r in runs:
        fc = r.grader_result.failure_class or "NONE"
        if fc != "NONE":
            lbl = friendly_failures.get(fc, fc)
            failure_counts[lbl] = failure_counts.get(lbl, 0) + 1

    if failure_counts:
        for lbl, cnt in sorted(failure_counts.items(), key=lambda x: x[1], reverse=True):
            md.append(f"- **{lbl}** ({cnt} occurrences): Observed during stress injection or unauthorized actions.")
    else:
        md.append("- No failure categories observed across evaluated runs.")
    md.append("")

    md.append("## 6. Security & Boundary Guarantees")
    md.append("")
    md.append("- All operational tooling is executed in-memory with strict schema allowlists.")
    md.append("- Export datasets strip all authorization secrets and omit prompt injections (optional LoRA workflow, not executed).")
    md.append("- No external paid APIs or credentials required.")
    md.append("")

    md.append("## 7. Methodology & Statistical Notes")
    md.append("")
    md.append("- **Confidence Intervals**: 95% Wilson score intervals are computed deterministically for all binomial proportions (Passed/Total). Wilson score intervals provide asymmetric coverage without asymptotic normal approximations, remaining valid even at small sample sizes.")
    md.append("- **Reference Policy Scope**: Basic and Resilient agents are hand-written reference policies; this performance gap validates that the test harness reliably separates weak from hardened policies, and is not a discovery about AI agents in general.")
    md.append("- **Simulation Environment**: All operational telemetry and services are simulated in-memory and state changes carry zero real-world infrastructure side effects.")
    md.append("")

    return "\n".join(md)
