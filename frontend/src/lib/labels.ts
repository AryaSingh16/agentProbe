/**
 * AgentProbe Centralized Display Label Layer
 * 
 * Single source of truth for converting internal IDs (scenarios, faults, tools,
 * policies, events, failure classes, evidence) into user-friendly display labels.
 * 
 * Never render raw snake_case or function-call syntax in user-facing components.
 */

export const SCENARIO_LABELS: Record<string, string> = {
  healthy_service: 'Healthy service',
  bad_deploy: 'Bad deployment',
  rollback_denied: 'Unauthorized rollback',
  unfixable_rollback: "Rollback can't fix it",
  injected_instruction: 'Malicious log instruction',
};

export const FAULT_LABELS: Record<string, string> = {
  none: 'No fault',
  timeout: 'Timeout',
  http_500: 'Server error',
  malformed_json: 'Malformed response',
  empty_response: 'Empty response',
  transient_then_success: 'Temporary failure',
};

export const TOOL_LABELS: Record<string, string> = {
  get_health: 'Check health',
  get_errors: 'Read error logs',
  request_rollback: 'Roll back deploy',
  verify_recovery: 'Verify recovery',
  finish: 'Finish',
};

export const EVENT_TYPE_LABELS: Record<string, string> = {
  THOUGHT: 'Reasoning',
  thought: 'Reasoning',
  TOOL_CALL: 'Action',
  tool_call: 'Action',
  RESULT: 'Result',
  tool_result: 'Result',
  result: 'Result',
  FAULT_INJECTED: 'Fault injected',
  fault_injected: 'Fault injected',
  FINAL_ANSWER: 'Conclusion',
  final_answer: 'Conclusion',
};

export const POLICY_LABELS: Record<string, string> = {
  naive: 'Basic agent',
  Naive: 'Basic agent',
  robust: 'Resilient agent',
  Robust: 'Resilient agent',
  llm: 'Language model (recorded)',
  'llm-replay': 'Language model (recorded)',
  'llm-recorded': 'Language model (recorded)',
  'llm-live': 'Language model (live)',
  'LLM (recorded)': 'Language model (recorded)',
  'LLM (live)': 'Language model (live)',
};

export const FAILURE_CLASS_LABELS: Record<string, string> = {
  UNAUTHORIZED_ACTION: 'Unauthorized action',
  UNVERIFIED_STATE: 'Unverified state',
  POLICY_VIOLATION: 'Policy violation',
  GOAL_NOT_ACHIEVED: 'Goal not achieved',
  TOOL_FAILURE: 'Tool failure',
  NONE: 'None',
};

export const EVIDENCE_LABELS: Record<string, string> = {
  health_checked: 'Checked service health',
  errors_checked: 'Checked error logs',
  rollback_executed: 'Executed rollback',
  recovery_verified: 'Verified recovery postcondition',
};

export const FORBIDDEN_ACTION_LABELS: Record<string, string> = {
  request_rollback: 'Not allowed: Roll back deploy',
  get_health: 'Not allowed: Check health',
  get_errors: 'Not allowed: Read error logs',
  verify_recovery: 'Not allowed: Verify recovery',
};

/**
 * Fallback to human-readable title case when an unknown ID is encountered.
 */
export function humanizeId(id: string | null | undefined): string {
  if (!id) return '';
  // Check direct maps first
  if (SCENARIO_LABELS[id]) return SCENARIO_LABELS[id];
  if (FAULT_LABELS[id]) return FAULT_LABELS[id];
  if (TOOL_LABELS[id]) return TOOL_LABELS[id];
  if (POLICY_LABELS[id]) return POLICY_LABELS[id];
  if (FAILURE_CLASS_LABELS[id]) return FAILURE_CLASS_LABELS[id];
  if (EVIDENCE_LABELS[id]) return EVIDENCE_LABELS[id];
  if (EVENT_TYPE_LABELS[id]) return EVENT_TYPE_LABELS[id];

  return id
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getScenarioLabel(id: string | null | undefined): string {
  if (!id) return 'Unknown scenario';
  return SCENARIO_LABELS[id] || humanizeId(id);
}

export function getFaultLabel(id: string | null | undefined): string {
  if (!id) return 'No fault';
  return FAULT_LABELS[id] || humanizeId(id);
}

export function getToolLabel(name: string | null | undefined): string {
  if (!name) return 'Unknown tool';
  // Strip trailing () if present
  const clean = name.replace(/\(\)$/, '');
  return TOOL_LABELS[clean] || humanizeId(clean);
}

export function getEventTypeLabel(type: string | null | undefined): string {
  if (!type) return 'Event';
  return EVENT_TYPE_LABELS[type] || humanizeId(type);
}

export function getPolicyLabel(agent: string | null | undefined): string {
  if (!agent) return 'Unknown agent';
  return POLICY_LABELS[agent] || humanizeId(agent);
}

export function getFailureClassLabel(fc: string | null | undefined): string {
  if (!fc) return 'None';
  return FAILURE_CLASS_LABELS[fc] || humanizeId(fc);
}

export function getEvidenceLabel(evidence: string | null | undefined): string {
  if (!evidence) return '';
  return EVIDENCE_LABELS[evidence] || humanizeId(evidence);
}

export function getForbiddenActionLabel(tool: string | null | undefined): string {
  if (!tool) return 'Not allowed';
  if (FORBIDDEN_ACTION_LABELS[tool]) return FORBIDDEN_ACTION_LABELS[tool];
  return `Not allowed: ${getToolLabel(tool)}`;
}

export function formatRunId(id: string | null | undefined): string {
  if (!id) return '';
  return id.replace(/_/g, '-').toUpperCase();
}

/**
 * Creates clean, plain-English event descriptions for timeline views,
 * eliminating function-call syntax and raw json payloads.
 */
export function formatEventSentence(event: {
  type: string;
  tool?: string | null;
  input?: Record<string, any> | null;
  output?: any;
  error?: string | null;
  fault_injected?: { type: string; call_index?: number; total_faults?: number } | null;
  thought?: string | null;
  details?: Record<string, any> | null;
}): string {
  const eventType = (event.type || '').toLowerCase();

  if (eventType === 'thought') {
    return event.thought || 'Agent evaluated next action';
  }

  if (eventType === 'fault_injected') {
    const fType = event.fault_injected?.type
      ? getFaultLabel(event.fault_injected.type).toLowerCase()
      : 'injected fault';
    const cur = event.fault_injected?.call_index;
    const tot = event.fault_injected?.total_faults;
    if (cur && tot) {
      return `Fault injected: ${fType} (${cur} of ${tot})`;
    }
    return `Fault injected: ${fType}`;
  }

  if (eventType === 'tool_call') {
    const tool = event.tool || '';
    const service = event.input?.service || 'target service';

    if (tool === 'get_health') {
      return `Checked health of ${service}`;
    }
    if (tool === 'get_errors') {
      return `Read error logs of ${service}`;
    }
    if (tool === 'request_rollback') {
      return `Rolled back deploy on ${service}`;
    }
    if (tool === 'verify_recovery') {
      return `Verified recovery of ${service}`;
    }
    if (tool === 'finish') {
      return 'Completed operational tasks';
    }
    return `Executed ${getToolLabel(tool).toLowerCase()} on ${service}`;
  }

  if (eventType === 'tool_result' || eventType === 'result') {
    if (event.error) {
      return `Action failed: ${event.error}`;
    }
    const tool = event.tool || '';
    if (tool === 'get_health') {
      const status = typeof event.output === 'object' && event.output?.status ? event.output.status : 'returned';
      return `Health check ${status}`;
    }
    if (tool === 'get_errors') {
      return 'Retrieved error log entries';
    }
    if (tool === 'request_rollback') {
      return 'Rollback request completed';
    }
    if (tool === 'verify_recovery') {
      const rec = typeof event.output === 'object' && event.output?.recovered ? 'Service recovered' : 'Recovery pending';
      return rec;
    }
    return 'Action result received';
  }

  if (eventType === 'final_answer') {
    const reason = event.details?.finish_reason || 'Task concluded';
    return `Task completed: ${reason}`;
  }

  return humanizeId(event.type);
}
