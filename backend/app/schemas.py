"""
AgentProbe Schemas: Pydantic models for scenarios, faults, policies, traces, grading,
shrinking, diagnosis, hardening, and analytics.
"""
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class FaultType(str, Enum):
    TIMEOUT = "timeout"
    HTTP_500 = "http_500"
    MALFORMED_JSON = "malformed_json"
    EMPTY_RESPONSE = "empty_response"
    TRANSIENT_THEN_SUCCESS = "transient_then_success"


class FaultSpec(BaseModel):
    model_config = ConfigDict(use_enum_values=True)
    fault_id: str = Field(description="Unique fault identifier (e.g. F01)")
    tool: str = Field(description="Target tool to inject fault into")
    type: FaultType = Field(description="Type of fault")
    call_index: int = Field(default=1, description="1-indexed call to this tool on which fault triggers")
    count: int = Field(default=1, description="Number of sequential failures before success (transient)")


FaultSchedule = List[FaultSpec]


class PolicyConfig(BaseModel):
    max_retries: int = Field(default=0, ge=0, le=10, description="Retry budget on transient failures")
    validate_schema: bool = Field(default=False, description="Validate tool JSON return structure")
    treat_output_as_data: bool = Field(default=False, description="Isolate tool output from execution instructions")
    verify_postconditions: bool = Field(default=False, description="Always verify recovery state after mutating actions")


class AgentType(str, Enum):
    NAIVE = "naive"
    ROBUST = "robust"
    LLM_REPLAY = "llm-replay"
    LLM_LIVE = "llm-live"


class ToolName(str, Enum):
    GET_HEALTH = "get_health"
    GET_ERRORS = "get_errors"
    REQUEST_ROLLBACK = "request_rollback"
    VERIFY_RECOVERY = "verify_recovery"


class TraceEventType(str, Enum):
    THOUGHT = "thought"
    TOOL_CALL = "tool_call"
    TOOL_RESULT = "tool_result"
    FAULT_INJECTED = "fault_injected"
    AGENT_RETRY = "agent_retry"
    ERROR = "error"
    FINAL_ANSWER = "final_answer"
    POLICY_VIOLATION = "policy_violation"


class TraceEvent(BaseModel):
    model_config = ConfigDict(use_enum_values=True)
    event_id: str = Field(description="Trace event ID, e.g. E01, E02")
    step_index: int = Field(description="Step index in trace")
    timestamp: str = Field(description="ISO timestamp")
    type: TraceEventType = Field(description="Event type")
    tool: Optional[str] = None
    input: Optional[Dict[str, Any]] = None
    output: Optional[Any] = None
    error: Optional[str] = None
    fault_id: Optional[str] = None
    details: Optional[Dict[str, Any]] = None


class Verdict(str, Enum):
    PASSED = "PASSED"
    FAILED = "FAILED"
    BLOCKED = "BLOCKED"


class FailureClass(str, Enum):
    NONE = "NONE"
    UNHANDLED_TOOL_ERROR = "UNHANDLED_TOOL_ERROR"
    POLICY_VIOLATION_INJECTION = "POLICY_VIOLATION_INJECTION"
    POLICY_VIOLATION_UNAUTHORIZED = "POLICY_VIOLATION_UNAUTHORIZED"
    UNVERIFIED_STATE = "UNVERIFIED_STATE"
    GOAL_NOT_ACHIEVED = "GOAL_NOT_ACHIEVED"
    PREMATURE_TERMINATION = "PREMATURE_TERMINATION"
    STEP_LIMIT_EXCEEDED = "STEP_LIMIT_EXCEEDED"


class GraderResult(BaseModel):
    model_config = ConfigDict(use_enum_values=True)
    verdict: Verdict
    goal_achieved: bool
    evidence_found: List[str] = Field(default_factory=list)
    evidence_required: List[str] = Field(default_factory=list)
    tool_calls: int = 0
    tool_errors: int = 0
    faults_encountered: int = 0
    faults_recovered: int = 0
    policy_violations: List[str] = Field(default_factory=list)
    failure_class: Optional[str] = None
    failure_reasons: List[str] = Field(default_factory=list)


class RunMetrics(BaseModel):
    tool_calls: int = 0
    tool_errors: int = 0
    faults_encountered: int = 0
    faults_recovered: int = 0
    execution_time_ms: float = 0.0


class ScenarioSpec(BaseModel):
    scenario_id: str
    title: str
    description: str
    service_name: str = "payment-gateway"
    initial_version: str = "v2.1.0"
    target_healthy_version: str = "v2.0.9"
    auth_token: Optional[str] = None
    expected_evidence: List[str]
    allowed_actions: List[str]
    forbidden_actions: List[str]
    injected_instruction: Optional[str] = None
    rollback_effective: bool = True


class RunCreateRequest(BaseModel):
    scenario_id: str = "bad_deploy"
    agent_type: str = "robust"
    policy_config: Optional[PolicyConfig] = None
    fault_type: Optional[str] = None
    fault_intensity: int = Field(default=0, ge=0, le=5)
    seed: int = 42
    custom_fault_schedule: Optional[List[FaultSpec]] = None


class RunResponse(BaseModel):
    id: str
    scenario_id: str
    agent_type: str
    policy_config: PolicyConfig
    seed: int
    fault_schedule: List[FaultSpec]
    trace: List[TraceEvent]
    grader_result: GraderResult
    metrics: RunMetrics
    created_at: str
    provenance: str = "simulator-generated"
    source: str = "user"


class MinimalFaultSet(BaseModel):
    minimal_faults: List[FaultSpec]
    counterfactual_runs: List[Dict[str, Any]]
    iterations_count: int
    original_fault_count: int
    minimal_fault_count: int


class Diagnosis(BaseModel):
    observed_facts: List[str] = Field(description="Facts citing event IDs (e.g. E02: Tool failed)")
    inferred_explanation: str = Field(description="Explanation citing event IDs")
    root_cause: str
    missing_evidence: List[str] = Field(default_factory=list)
    recommendations: List[str] = Field(default_factory=list)


class HardeningResult(BaseModel):
    original_policy: PolicyConfig
    patched_policy: PolicyConfig
    policy_diff: Dict[str, Any]
    before_metrics: Dict[str, Any]
    after_metrics: Dict[str, Any]
    fixed_failures: List[str]
    remaining_failures: List[str]
    re_run_id: str
    re_run_verdict: str


class PredictorTrainResponse(BaseModel):
    accuracy: float
    auc: Optional[float]
    sample_size: int
    warning: str = "simulation data, not evaluated for production use"
    feature_importances: Dict[str, float]
    # Additive fields for honesty & real data requirements
    status: str = "Simulation-based risk estimation"
    is_insufficient_data: bool = False
    metrics_meaningful: bool = True
    class_balance: Dict[str, int] = Field(default_factory=dict)
    majority_class_baseline_accuracy: float = 0.0
    beats_baseline: Optional[bool] = None
    baseline_comparison: str = ""
    split_strategy: str = "leave_one_scenario_out"
    real_runs_only: bool = True
    unique_configurations_count: int = 0
    leave_one_scenario_out_accuracy: Optional[float] = None
    leave_one_fault_out_accuracy: Optional[float] = None
    estimator_note: str = (
        "Outcomes in this simulator are deterministic, so high scores are expected and do not show real-world predictive power."
    )


class PredictorPredictRequest(BaseModel):
    scenario_id: str
    policy: PolicyConfig
    fault_type: Optional[str] = None
    fault_intensity: int = 1


class PredictorPredictResponse(BaseModel):
    failure_risk_probability: float
    risk_level: str  # LOW, MEDIUM, HIGH
    contributing_factors: List[str]
    warning: str = "simulation-based estimate"
    model_estimate_probability: Optional[float] = None
    model_risk_level: Optional[str] = None
    simulated_check_failures: Optional[int] = None
    simulated_check_total: Optional[int] = None
    simulated_check_rate: Optional[float] = None
    simulated_check_formatted: Optional[str] = None
    disagreement: Optional[bool] = None
    unique_configurations_count: Optional[int] = None
    leave_one_scenario_out_accuracy: Optional[float] = None
    majority_class_baseline: Optional[float] = None
    note: Optional[str] = (
        "Outcomes in this simulator are deterministic, so high scores are expected and do not show real-world predictive power."
    )
    per_fault_risks: Optional[Dict[str, float]] = None


class MatrixCellStats(BaseModel):
    passed: int = 0
    total: int = 0
    rate: Optional[float] = None
    formatted: str = "N/A"
    ci_lower: Optional[float] = None
    ci_upper: Optional[float] = None
    is_low_sample: bool = True


class AggregateMetrics(BaseModel):
    total_runs: int
    success_rate: Optional[float] = None
    tool_error_rate: Optional[float] = None
    recovery_rate: Optional[float] = None
    policy_violation_rate: Optional[float] = None
    avg_tool_calls: Optional[float] = None
    recovery_degradation: Optional[float] = None

    # Additive fields with sample size and Wilson 95% Confidence Intervals
    success_count: int = 0
    success_formatted: str = "N/A"
    success_ci_95: Optional[List[float]] = None

    tool_errors_count: int = 0
    tool_calls_total: int = 0
    tool_error_formatted: str = "N/A"
    tool_error_ci_95: Optional[List[float]] = None

    faults_recovered_count: int = 0
    faults_encountered_count: int = 0
    recovery_formatted: str = "N/A"
    recovery_ci_95: Optional[List[float]] = None

    policy_violations_runs: int = 0
    policy_violation_formatted: str = "N/A"
    policy_violation_ci_95: Optional[List[float]] = None

    is_low_sample: bool = False
    metrics_note: str = (
        "Naive and Robust are author-written reference policies; this performance gap validates that "
        "the test harness reliably separates weak from hardened policies, and is not a discovery about AI agents in general."
    )
