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
    warning: str = "small-data, not validated for production use"
    feature_importances: Dict[str, float]


class PredictorPredictRequest(BaseModel):
    scenario_id: str
    policy: PolicyConfig
    fault_type: Optional[str] = None
    fault_intensity: int = 1


class PredictorPredictResponse(BaseModel):
    failure_risk_probability: float
    risk_level: str  # LOW, MEDIUM, HIGH
    contributing_factors: List[str]
    warning: str = "small-data, not validated for production use"


class AggregateMetrics(BaseModel):
    total_runs: int
    success_rate: Optional[float] = None
    tool_error_rate: Optional[float] = None
    recovery_rate: Optional[float] = None
    policy_violation_rate: Optional[float] = None
    avg_tool_calls: Optional[float] = None
    recovery_degradation: Optional[float] = None
