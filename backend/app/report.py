"""
AgentProbe Report and Export Generator:
- Generates sanitized fine-tuning datasets from successful RobustAgent runs (secrets stripped, prompt injections excluded).
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
    Generates chat-format fine-tuning examples from SUCCESSFUL graded RobustAgent runs only.
    Strictly filters out prompt injection scenarios and strips all secrets.
    """
    lines: List[str] = []

    for run in runs:
        # Ground rule: ONLY successful RobustAgent runs
        if run.grader_result.verdict != "PASSED" or run.agent_type != "robust":
            continue

        # Exclude prompt injection scenarios from fine-tuning corpus to prevent training on adversarial text
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
    """
    aggs = DeterministicGrader.compute_aggregates([r.model_dump() for r in runs])

    md = []
    md.append("# AgentProbe Stress-Testing and Reliability Report")
    md.append("")
    md.append("Generated autonomously by AgentProbe platform.")
    md.append("")
    md.append("## 1. Executive Summary")
    md.append("")
    md.append(f"- **Total Experiments Evaluated**: n = {aggs.total_runs}")

    succ_ci_str = f" [95% CI: {aggs.success_ci_95[0]*100:.1f}% – {aggs.success_ci_95[1]*100:.1f}%]" if aggs.success_ci_95 else ""
    md.append(f"- **Overall Task Success Rate**: {aggs.success_formatted}{succ_ci_str}")

    err_ci_str = f" [95% CI: {aggs.tool_error_ci_95[0]*100:.1f}% – {aggs.tool_error_ci_95[1]*100:.1f}%]" if aggs.tool_error_ci_95 else ""
    md.append(f"- **Tool Error Rate**: {aggs.tool_error_formatted}{err_ci_str}")

    rec_ci_str = f" [95% CI: {aggs.recovery_ci_95[0]*100:.1f}% – {aggs.recovery_ci_95[1]*100:.1f}%]" if aggs.recovery_ci_95 else ""
    md.append(f"- **Fault Recovery Rate**: {aggs.recovery_formatted}{rec_ci_str}")

    viol_ci_str = f" [95% CI: {aggs.policy_violation_ci_95[0]*100:.1f}% – {aggs.policy_violation_ci_95[1]*100:.1f}%]" if aggs.policy_violation_ci_95 else ""
    md.append(f"- **Policy Violation Rate**: {aggs.policy_violation_formatted}{viol_ci_str}")

    md.append(f"- **Avg Tool Calls Per Run**: {aggs.avg_tool_calls if aggs.avg_tool_calls is not None else 'N/A'}")
    md.append(f"- **Recovery Degradation (Baseline - Faulted)**: {f'{aggs.recovery_degradation * 100:.1f}%' if aggs.recovery_degradation is not None else 'N/A'}")
    md.append("")
    md.append("> **Statistical Note**: Naive and Robust are author-written reference policies; this performance gap validates that the test harness reliably separates weak from hardened policies, and is not a discovery about AI agents in general.")
    md.append("")

    md.append("## 2. Policy Performance Breakdown")
    md.append("")
    md.append("| Agent / Policy | Sample Size (Passed/Total) | Success Rate | 95% Wilson CI | Violations | Faults Recovered |")
    md.append("|---|---|---|---|---|---|")

    # Group by agent_type
    agents = {}
    for r in runs:
        agents.setdefault(r.agent_type, []).append(r)

    for agent_name, agent_runs in agents.items():
        sub_aggs = DeterministicGrader.compute_aggregates([r.model_dump() for r in agent_runs])
        ci_str = f"[{sub_aggs.success_ci_95[0]*100:.1f}%, {sub_aggs.success_ci_95[1]*100:.1f}%]" if sub_aggs.success_ci_95 else "N/A"
        low_badge = " *(low sample n<10)*" if len(agent_runs) < 10 else ""
        v_count = sum(len(r.grader_result.policy_violations) for r in agent_runs)
        rec_count = sum(r.grader_result.faults_recovered for r in agent_runs)
        md.append(f"| `{agent_name}` | {sub_aggs.success_formatted}{low_badge} | {f'{sub_aggs.success_rate * 100:.1f}%' if sub_aggs.success_rate is not None else 'N/A'} | {ci_str} | {v_count} | {rec_count} |")
    md.append("")

    md.append("## 3. Reliability Matrix (Policy x Fault Type)")
    md.append("")
    md.append("| Agent / Policy | Fault Type | Passed / Total | Success Rate | 95% Wilson CI | Sample Status |")
    md.append("|---|---|---|---|---|---|")
    matrix_cells = {}
    from app.stats import format_rate_with_n, wilson_score_interval
    for r in runs:
        ag = r.agent_type
        ft = r.fault_schedule[0].type if r.fault_schedule else "none"
        matrix_cells.setdefault(ag, {}).setdefault(ft, {"passed": 0, "total": 0})
        matrix_cells[ag][ft]["total"] += 1
        if r.grader_result.verdict == "PASSED":
            matrix_cells[ag][ft]["passed"] += 1

    for ag, fts in matrix_cells.items():
        for ft, c in fts.items():
            p, t = c["passed"], c["total"]
            r_str = f"{p/t*100:.1f}%" if t > 0 else "N/A"
            lower, upper = wilson_score_interval(p, t)
            ci_str = f"[{lower*100:.1f}%, {upper*100:.1f}%]" if lower is not None else "N/A"
            status_tag = "**Low sample (n<10)**" if t < 10 else "Adequate sample"
            md.append(f"| `{ag}` | `{ft}` | {p}/{t} | {r_str} | {ci_str} | {status_tag} |")
    md.append("")

    md.append("## 4. Evaluated Scenarios")
    md.append("")
    md.append("| Scenario | Total Runs | Passed | Failed | Blocked |")
    md.append("|---|---|---|---|---|")
    scenarios = {}
    for r in runs:
        scenarios.setdefault(r.scenario_id, []).append(r)

    for s_id, s_runs in scenarios.items():
        p = sum(1 for r in s_runs if r.grader_result.verdict == "PASSED")
        f = sum(1 for r in s_runs if r.grader_result.verdict == "FAILED")
        b = sum(1 for r in s_runs if r.grader_result.verdict == "BLOCKED")
        md.append(f"| `{s_id}` | {len(s_runs)} | {p} | {f} | {b} |")
    md.append("")

    md.append("## 5. Key Failure Classes & Root Cause Observations")
    md.append("")
    failure_counts = {}
    for r in runs:
        fc = r.grader_result.failure_class or "NONE"
        if fc != "NONE":
            failure_counts[fc] = failure_counts.get(fc, 0) + 1

    if failure_counts:
        for fc, cnt in sorted(failure_counts.items(), key=lambda x: x[1], reverse=True):
            md.append(f"- **`{fc}`** ({cnt} occurrences): Observed during stress injection or unauthorized actions.")
    else:
        md.append("- No failure classes observed across evaluated runs.")
    md.append("")

    md.append("## 5. Security & Boundary Guarantees")
    md.append("")
    md.append("- All operational tooling is executed in-memory with strict schema allowlists.")
    md.append("- Fine-tuning datasets strip all authorization secrets and omit prompt injections.")
    md.append("- No external paid APIs or credentials required.")
    md.append("")

    return "\n".join(md)
