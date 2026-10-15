export type Verdict = 'PASSED' | 'FAILED' | 'BLOCKED';

export interface PolicyConfig {
  max_retries: number;
  validate_schema: boolean;
  treat_output_as_data: boolean;
  verify_postconditions: boolean;
}

export interface FaultSpec {
  fault_id: string;
  tool: string;
  type: string;
  call_index: number;
  count: number;
}

export interface TraceEvent {
  event_id: string;
  step_index: number;
  timestamp: string;
  type: string;
  tool?: string;
  input?: Record<string, any>;
  output?: any;
  error?: string;
  fault_id?: string;
  details?: Record<string, any>;
}

export interface GraderResult {
  verdict: Verdict;
  goal_achieved: boolean;
  evidence_found: string[];
  evidence_required: string[];
  tool_calls: number;
  tool_errors: number;
  faults_encountered: number;
  faults_recovered: number;
  policy_violations: string[];
  failure_class?: string;
  failure_reasons: string[];
}

export interface RunMetrics {
  tool_calls: number;
  tool_errors: number;
  faults_encountered: number;
  faults_recovered: number;
  execution_time_ms: number;
}

export interface RunResponse {
  id: string;
  scenario_id: string;
  agent_type: string;
  policy_config: PolicyConfig;
  seed: number;
  fault_schedule: FaultSpec[];
  trace: TraceEvent[];
  grader_result: GraderResult;
  metrics: RunMetrics;
  created_at: string;
}

export interface ScenarioSpec {
  scenario_id: string;
  title: string;
  description: string;
  service_name: string;
  initial_version: string;
  target_healthy_version: string;
  auth_token?: string;
  expected_evidence: string[];
  allowed_actions: string[];
  forbidden_actions: string[];
  injected_instruction?: string;
  rollback_effective: boolean;
}

export interface CassetteMetadata {
  cassette_id: string;
  provenance: string;
  description: string;
  scenario_id: string;
  model: string;
}

export interface AggregateMetrics {
  total_runs: number;
  success_rate: number | null;
  tool_error_rate: number | null;
  recovery_rate: number | null;
  policy_violation_rate: number | null;
  avg_tool_calls: number | null;
  recovery_degradation: number | null;
}

export interface MinimalFaultSet {
  minimal_faults: FaultSpec[];
  counterfactual_runs: Array<{
    run_id: string;
    fault_count: number;
    fault_ids: string[];
    verdict: Verdict;
    failure_class: string;
    reproduces_target_failure: boolean;
  }>;
  iterations_count: number;
  original_fault_count: number;
  minimal_fault_count: number;
}

export interface Diagnosis {
  observed_facts: string[];
  inferred_explanation: string;
  root_cause: string;
  missing_evidence: string[];
  recommendations: string[];
}

export interface HardeningResult {
  original_policy: PolicyConfig;
  patched_policy: PolicyConfig;
  policy_diff: Record<string, { before: any; after: any }>;
  before_metrics: Record<string, any>;
  after_metrics: Record<string, any>;
  fixed_failures: string[];
  remaining_failures: string[];
  re_run_id: string;
  re_run_verdict: string;
}

export interface PredictorTrainResponse {
  accuracy: number;
  auc: number | null;
  sample_size: number;
  warning: string;
  feature_importances: Record<string, number>;
}

export interface PredictorPredictResponse {
  failure_risk_probability: number;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  contributing_factors: string[];
  warning: string;
}

export interface MatrixJobStatusResponse {
  job_id: string;
  status: string;
  total_runs: number;
  completed_runs: number;
  created_at: string;
  completed_at?: string;
  heatmap?: Record<string, Record<string, number | null>>;
  summary?: AggregateMetrics;
}
