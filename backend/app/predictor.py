"""
AgentProbe Failure-Risk Predictor (What-if risk estimator):
Estimates failure risk probability for proposed policy configurations and fault injections.
Trains on unique simulation configurations with Leave-One-Scenario-Out (LOSO) cross validation.
Provides side-by-side comparison between statistical model estimates and empirical simulation checks.
Never uses synthetic data; trains strictly on unique simulation configurations.
"""
import copy
import logging
from typing import Any, Dict, List, Optional, Tuple
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, roc_auc_score
from sklearn.model_selection import GroupShuffleSplit

from app.schemas import (
    PolicyConfig,
    PredictorPredictRequest,
    PredictorPredictResponse,
    PredictorTrainResponse,
    RunCreateRequest,
    RunResponse,
)

logger = logging.getLogger(__name__)

SCENARIOS = [
    "healthy_service",
    "bad_deploy",
    "rollback_denied",
    "unfixable_rollback",
    "injected_instruction",
]

FAULT_TYPES = [
    "none",
    "timeout",
    "http_500",
    "malformed_json",
    "empty_response",
    "transient_then_success",
]

FEATURE_NAMES = (
    [f"scen_{s}" for s in SCENARIOS]
    + [f"fault_{f}" for f in FAULT_TYPES]
    + [
        "policy_max_retries",
        "policy_validate_schema",
        "policy_treat_output_as_data",
        "policy_verify_postconditions",
        "fault_intensity",
    ]
)


def extract_features(
    scenario_id: str,
    policy: PolicyConfig,
    fault_type: Optional[str],
    fault_intensity: int,
) -> List[float]:
    """
    Extracts one-hot encoded scenario and fault type features with continuous guardrails.
    Prevents saturation and ordinal artifacts.
    """
    feats = []
    # Scenario one-hot
    for s in SCENARIOS:
        feats.append(1.0 if scenario_id == s else 0.0)

    # Fault type one-hot
    f_clean = fault_type or "none"
    for f in FAULT_TYPES:
        feats.append(1.0 if f_clean == f else 0.0)

    # Policy guardrails
    feats.append(min(float(policy.max_retries), 5.0) / 5.0)
    feats.append(1.0 if policy.validate_schema else 0.0)
    feats.append(1.0 if policy.treat_output_as_data else 0.0)
    feats.append(1.0 if policy.verify_postconditions else 0.0)
    feats.append(min(float(fault_intensity), 5.0) / 5.0)

    return feats


def get_leakage_safe_split(
    groups: np.ndarray,
    test_size: float = 0.25,
    random_state: int = 42,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Splits indices ensuring zero group overlap (leakage-safe split by scenario+seed).
    """
    unique_groups = np.unique(groups)
    if len(unique_groups) < 2:
        indices = np.arange(len(groups))
        return indices, indices

    gss = GroupShuffleSplit(n_splits=1, test_size=test_size, random_state=random_state)
    train_idx, val_idx = next(gss.split(groups, groups=groups))
    return train_idx, val_idx


def generate_unique_simulation_configurations() -> List[Tuple[List[float], int, str, str]]:
    """
    Generates ground-truth outcomes across unique simulator configurations:
    5 scenarios x 2 policies x 6 fault types = 60 configurations.
    Deterministic, offline, fast.
    """
    from app.runner import run_experiment
    configs = []
    for s in SCENARIOS:
        for ag in ["naive", "robust"]:
            pol = (
                PolicyConfig(max_retries=0, validate_schema=False, treat_output_as_data=False, verify_postconditions=False)
                if ag == "naive"
                else PolicyConfig(max_retries=3, validate_schema=True, treat_output_as_data=True, verify_postconditions=True)
            )
            for ft in FAULT_TYPES:
                intensity = 0 if ft == "none" else 1
                try:
                    res = run_experiment(RunCreateRequest(
                        scenario_id=s,
                        agent_type=ag,
                        fault_type=None if ft == "none" else ft,
                        fault_intensity=intensity,
                        seed=42,
                    ))
                    label = 1 if res.grader_result.verdict != "PASSED" else 0
                    feats = extract_features(s, pol, ft, intensity)
                    configs.append((feats, label, s, ft))
                except Exception as e:
                    logger.warning(f"Failed to generate config outcome for {s} {ag} {ft}: {e}")
    return configs


class FailureRiskPredictor:
    def __init__(self):
        self.model: Optional[LogisticRegression] = None
        self.sample_size: int = 0
        self.unique_configs_count: int = 0
        self.last_accuracy: float = 0.0
        self.last_auc: Optional[float] = None
        self.loso_accuracy: Optional[float] = None
        self.majority_baseline: float = 0.0
        self.feature_importances: Dict[str, float] = {name: 0.0 for name in FEATURE_NAMES}
        self._ensure_fitted()

    def _ensure_fitted(self):
        if self.model is None:
            sim_configs = generate_unique_simulation_configurations()
            if sim_configs:
                X = [c[0] for c in sim_configs]
                y = [c[1] for c in sim_configs]
                clf = LogisticRegression(C=1.0, max_iter=300, random_state=42)
                clf.fit(X, y)
                self.model = clf
                self.unique_configs_count = len(sim_configs)

    def train(self, runs: List[RunResponse]) -> PredictorTrainResponse:
        """
        Trains model on unique configurations.
        Performs Leave-One-Scenario-Out (LOSO) cross-validation.
        """
        self.sample_size = len(runs)
        is_insufficient = self.sample_size < 200

        # Build ground-truth unique configurations
        sim_configs = generate_unique_simulation_configurations()

        # Augment with any unique configs from stored runs
        config_map: Dict[Tuple, int] = {}
        for c in sim_configs:
            cfg_tuple = tuple(c[0])
            config_map[cfg_tuple] = c[1]

        for r in runs:
            f_type = r.fault_schedule[0].type if r.fault_schedule else "none"
            f_intensity = len(r.fault_schedule)
            feats = extract_features(r.scenario_id, r.policy_config, f_type, f_intensity)
            cfg_tuple = tuple(feats)
            is_failed = 1 if r.grader_result.verdict != "PASSED" else 0
            config_map[cfg_tuple] = is_failed

        self.unique_configs_count = len(config_map)

        X_arr = np.array(list(config_map.keys()))
        y_arr = np.array(list(config_map.values()))

        # Determine scenario for each config by decoding first 5 features
        scen_indices = [np.argmax(x[:len(SCENARIOS)]) for x in X_arr]
        scen_arr = np.array([SCENARIOS[idx] for idx in scen_indices])

        failed_count = int(np.sum(y_arr == 1))
        passed_count = int(np.sum(y_arr == 0))
        class_balance = {"failed": failed_count, "passed": passed_count}
        majority_count = max(failed_count, passed_count)
        self.majority_baseline = round(majority_count / len(y_arr), 4) if len(y_arr) > 0 else 0.0

        # Honest Leave-One-Scenario-Out (LOSO) Cross-Validation
        loso_correct = 0
        loso_total = 0

        for s in SCENARIOS:
            train_mask = scen_arr != s
            test_mask = scen_arr == s
            X_train, y_train = X_arr[train_mask], y_arr[train_mask]
            X_test, y_test = X_arr[test_mask], y_arr[test_mask]

            if len(X_test) == 0:
                continue

            fold_clf = LogisticRegression(C=1.0, max_iter=300, random_state=42)
            if len(np.unique(y_train)) < 2:
                pred = np.full(len(y_test), y_train[0] if len(y_train) > 0 else 0)
            else:
                fold_clf.fit(X_train, y_train)
                pred = fold_clf.predict(X_test)

            loso_correct += int(np.sum(pred == y_test))
            loso_total += len(y_test)

        self.loso_accuracy = round(loso_correct / loso_total, 4) if loso_total > 0 else 0.0

        # Fit final model on all unique configurations with L2 regularization
        clf = LogisticRegression(C=1.0, max_iter=300, random_state=42)
        clf.fit(X_arr, y_arr)
        self.model = clf

        preds = clf.predict(X_arr)
        self.last_accuracy = round(float(accuracy_score(y_arr, preds)), 4)

        try:
            probs = clf.predict_proba(X_arr)[:, 1]
            self.last_auc = round(float(roc_auc_score(y_arr, probs)), 4)
        except Exception:
            self.last_auc = None

        coefs = np.abs(clf.coef_[0])
        total_coef = float(np.sum(coefs)) if np.sum(coefs) > 0 else 1.0
        self.feature_importances = {
            name: round(float(c / total_coef), 4) for name, c in zip(FEATURE_NAMES, coefs)
        }

        beats = bool(self.loso_accuracy > self.majority_baseline)
        if beats:
            diff_pct = round((self.loso_accuracy - self.majority_baseline) * 100, 1)
            comp_msg = f"LOSO holdout accuracy ({self.loso_accuracy*100:.1f}%) beats majority baseline ({self.majority_baseline*100:.1f}%) by +{diff_pct}%."
        else:
            comp_msg = f"LOSO holdout accuracy: {self.loso_accuracy*100:.1f}% (majority baseline: {self.majority_baseline*100:.1f}%)."

        warning_text = (
            "Insufficient data: metrics are not meaningful (n < 200 simulation runs, small-data)"
            if is_insufficient
            else "simulation data, not evaluated for production use"
        )

        return PredictorTrainResponse(
            accuracy=self.loso_accuracy,
            auc=self.last_auc,
            sample_size=self.sample_size,
            warning=warning_text,
            feature_importances=self.feature_importances,
            status="Insufficient data: metrics are not meaningful" if is_insufficient else "Simulation-based risk estimation",
            is_insufficient_data=is_insufficient,
            metrics_meaningful=not is_insufficient,
            class_balance=class_balance,
            majority_class_baseline_accuracy=self.majority_baseline,
            beats_baseline=beats,
            baseline_comparison=comp_msg,
            split_strategy="leave_one_scenario_out",
            real_runs_only=True,
            unique_configurations_count=self.unique_configs_count,
            leave_one_scenario_out_accuracy=self.loso_accuracy,
            estimator_note="Outcomes in this simulator are deterministic, so high scores are expected and do not show real-world predictive power.",
        )

    def predict(self, req: PredictorPredictRequest) -> PredictorPredictResponse:
        """
        Estimates risk for proposed configuration and performs live 10-seed simulation check.
        """
        self._ensure_fitted()

        # Compute model estimate
        feats = extract_features(req.scenario_id, req.policy, req.fault_type, req.fault_intensity)
        X = np.array([feats])
        try:
            probs = self.model.predict_proba(X)
            raw_prob = float(probs[0][1]) if probs.shape[1] > 1 else float(probs[0][0])
        except Exception:
            raw_prob = 0.5

        prob = round(float(raw_prob), 3)

        if prob < 0.30:
            risk_level = "LOW"
        elif prob <= 0.70:
            risk_level = "MEDIUM"
        else:
            risk_level = "HIGH"

        # Compute per-fault-type risk estimates for the bar chart
        per_fault_risks = {}
        for ft in FAULT_TYPES:
            f_feats = extract_features(req.scenario_id, req.policy, ft, req.fault_intensity if ft != "none" else 0)
            try:
                f_probs = self.model.predict_proba(np.array([f_feats]))
                f_p = float(f_probs[0][1]) if f_probs.shape[1] > 1 else float(f_probs[0][0])
            except Exception:
                f_p = 0.5
            per_fault_risks[ft] = round(float(f_p), 3)

        # Run empirical simulation check across 10 deterministic seeds (42..51)
        from app.runner import run_experiment
        failures = 0
        total_checks = 10
        for s in range(42, 42 + total_checks):
            run_req = RunCreateRequest(
                scenario_id=req.scenario_id,
                policy_config=req.policy,
                fault_type=req.fault_type,
                fault_intensity=req.fault_intensity,
                seed=s,
            )
            try:
                res = run_experiment(run_req)
                if res.grader_result.verdict != "PASSED":
                    failures += 1
            except Exception as e:
                logger.warning(f"Sim check seed {s} failed: {e}")
                failures += 1

        sim_rate = round(failures / total_checks, 2)
        sim_formatted = f"{failures}/{total_checks} ({int(sim_rate * 100)}%)"
        disagreement = bool(abs(prob - sim_rate) >= 0.25)

        # Identify contributing risk factors
        factors = []
        if req.policy.max_retries == 0 and (req.fault_type not in (None, "none") and req.fault_intensity > 0):
            factors.append("Zero retry budget under active fault injection")
        if not req.policy.validate_schema and req.fault_type in ("malformed_json", "empty_response"):
            factors.append("Disabled schema validation against malformed payloads")
        if not req.policy.treat_output_as_data and req.scenario_id == "injected_instruction":
            factors.append("Prompt injection vulnerability in log processing")
        if not req.policy.verify_postconditions and req.scenario_id in ("bad_deploy", "unfixable_rollback"):
            factors.append("Missing postcondition verification after mutation")
        if req.scenario_id == "unfixable_rollback":
            factors.append("Service has persistent unfixable degradation")

        if not factors:
            factors.append("Robust configuration mitigates primary risk surfaces")

        return PredictorPredictResponse(
            failure_risk_probability=prob,
            risk_level=risk_level,
            contributing_factors=factors,
            warning="simulation-based estimate",
            model_estimate_probability=prob,
            model_risk_level=risk_level,
            simulated_check_failures=failures,
            simulated_check_total=total_checks,
            simulated_check_rate=sim_rate,
            simulated_check_formatted=sim_formatted,
            disagreement=disagreement,
            unique_configurations_count=self.unique_configs_count,
            leave_one_scenario_out_accuracy=self.loso_accuracy,
            majority_class_baseline=self.majority_baseline,
            note="Outcomes in this simulator are deterministic, so high scores are expected and do not show real-world predictive power.",
            per_fault_risks=per_fault_risks,
        )


predictor_engine = FailureRiskPredictor()
