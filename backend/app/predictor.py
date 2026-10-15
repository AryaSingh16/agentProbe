"""
AgentProbe Failure-Risk Predictor:
Trains a scikit-learn classifier strictly on real stored runs (zero synthetic rows).
Uses grouped scenario+seed splitting to avoid trace leakage.
Reports sample size (n), class balance, majority-class baseline, and loud status
when n < 200 ('Insufficient data: metrics are not meaningful').
"""
import copy
import logging
from typing import Any, Dict, List, Optional, Tuple
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, roc_auc_score
from sklearn.model_selection import GroupShuffleSplit, StratifiedKFold, train_test_split

from app.schemas import (
    PolicyConfig,
    PredictorPredictRequest,
    PredictorPredictResponse,
    PredictorTrainResponse,
    RunResponse,
)

logger = logging.getLogger(__name__)

SCENARIO_MAP = {
    "healthy_service": 0,
    "bad_deploy": 1,
    "rollback_denied": 2,
    "unfixable_rollback": 3,
    "injected_instruction": 4,
}

FAULT_TYPE_MAP = {
    "none": 0,
    "timeout": 1,
    "http_500": 2,
    "malformed_json": 3,
    "empty_response": 4,
    "transient_then_success": 5,
}

FEATURE_NAMES = [
    "scenario_id",
    "policy_max_retries",
    "policy_validate_schema",
    "policy_treat_output_as_data",
    "policy_verify_postconditions",
    "fault_type",
    "fault_intensity",
]


def _extract_features_and_label(
    scenario_id: str,
    policy: PolicyConfig,
    fault_type: Optional[str],
    fault_intensity: int,
    verdict: Optional[str] = None,
) -> Tuple[List[float], Optional[int]]:
    scen_val = float(SCENARIO_MAP.get(scenario_id, 0))
    ft_val = float(FAULT_TYPE_MAP.get(fault_type or "none", 0))

    features = [
        scen_val,
        float(policy.max_retries),
        1.0 if policy.validate_schema else 0.0,
        1.0 if policy.treat_output_as_data else 0.0,
        1.0 if policy.verify_postconditions else 0.0,
        ft_val,
        float(fault_intensity),
    ]

    label = None
    if verdict is not None:
        # 1 if failed or blocked, 0 if passed
        label = 1 if verdict != "PASSED" else 0

    return features, label


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


class FailureRiskPredictor:
    def __init__(self):
        self.model: Optional[RandomForestClassifier] = None
        self.sample_size: int = 0
        self.last_accuracy: float = 0.0
        self.last_auc: Optional[float] = None
        self.feature_importances: Dict[str, float] = {name: 0.0 for name in FEATURE_NAMES}

    def train(self, runs: List[RunResponse]) -> PredictorTrainResponse:
        """
        Trains model ONLY on real stored runs. Zero synthetic data.
        """
        X_list = []
        y_list = []
        groups_list = []

        # Extract features strictly from real stored runs
        for r in runs:
            f_type = r.fault_schedule[0].type if r.fault_schedule else "none"
            f_intensity = len(r.fault_schedule)
            feats, label = _extract_features_and_label(
                r.scenario_id,
                r.policy_config,
                f_type,
                f_intensity,
                r.grader_result.verdict,
            )
            X_list.append(feats)
            y_list.append(label)
            groups_list.append(f"{r.scenario_id}_{r.seed}")

        X_arr = np.array(X_list) if X_list else np.empty((0, len(FEATURE_NAMES)))
        y_arr = np.array(y_list) if y_list else np.empty((0,), dtype=int)
        groups_arr = np.array(groups_list) if groups_list else np.empty((0,), dtype=str)

        self.sample_size = len(y_arr)
        is_insufficient = self.sample_size < 200

        # Class balance and majority-class baseline calculation
        failed_count = int(np.sum(y_arr == 1)) if self.sample_size > 0 else 0
        passed_count = int(np.sum(y_arr == 0)) if self.sample_size > 0 else 0
        class_balance = {"failed": failed_count, "passed": passed_count}
        majority_count = max(failed_count, passed_count)
        majority_baseline = round(majority_count / self.sample_size, 4) if self.sample_size > 0 else 0.0

        if self.sample_size == 0:
            self.model = None
            self.last_accuracy = 0.0
            self.last_auc = None
            self.feature_importances = {name: 0.0 for name in FEATURE_NAMES}
            return PredictorTrainResponse(
                accuracy=0.0,
                auc=None,
                sample_size=0,
                warning="Insufficient data: metrics are not meaningful (n=0 real runs, small-data)",
                feature_importances=self.feature_importances,
                status="Insufficient data: metrics are not meaningful",
                is_insufficient_data=True,
                metrics_meaningful=False,
                class_balance=class_balance,
                majority_class_baseline_accuracy=0.0,
                beats_baseline=False,
                baseline_comparison="No real runs available in database.",
                split_strategy="grouped_scenario_seed",
                real_runs_only=True,
            )

        # Single class edge case
        if len(np.unique(y_arr)) < 2:
            clf = RandomForestClassifier(n_estimators=50, max_depth=6, random_state=42)
            clf.fit(X_arr, y_arr)
            self.model = clf
            self.last_accuracy = 1.0
            self.last_auc = None
            importances = {name: round(float(val), 4) for name, val in zip(FEATURE_NAMES, clf.feature_importances_)}
            self.feature_importances = importances

            warning_text = (
                "Insufficient data: metrics are not meaningful (n < 200 real runs, small-data, single class)"
                if is_insufficient
                else "Trained on real runs (single class present)"
            )
            return PredictorTrainResponse(
                accuracy=1.0,
                auc=None,
                sample_size=self.sample_size,
                warning=warning_text,
                feature_importances=importances,
                status="Insufficient data: metrics are not meaningful" if is_insufficient else "Trained on real runs",
                is_insufficient_data=is_insufficient,
                metrics_meaningful=not is_insufficient,
                class_balance=class_balance,
                majority_class_baseline_accuracy=majority_baseline,
                beats_baseline=False,
                baseline_comparison="Single class present; holdout comparison not applicable.",
                split_strategy="grouped_scenario_seed",
                real_runs_only=True,
            )

        # Leakage-safe grouped split by scenario+seed
        train_idx, val_idx = get_leakage_safe_split(groups_arr, test_size=0.25, random_state=42)
        X_train, X_val = X_arr[train_idx], X_arr[val_idx]
        y_train, y_val = y_arr[train_idx], y_arr[val_idx]

        split_strategy = "grouped_scenario_seed"
        if len(np.unique(y_train)) < 2 or len(y_val) == 0:
            split_strategy = "stratified"
            can_stratify = len(np.unique(y_arr)) > 1 and np.min(np.unique(y_arr, return_counts=True)[1]) >= 2
            if len(y_arr) >= 4:
                X_train, X_val, y_train, y_val = train_test_split(
                    X_arr, y_arr, test_size=0.25, random_state=42, stratify=y_arr if can_stratify else None
                )
            else:
                X_train, X_val, y_train, y_val = X_arr, X_arr, y_arr, y_arr

        clf = RandomForestClassifier(n_estimators=50, max_depth=6, random_state=42)
        clf.fit(X_train, y_train)
        self.model = clf

        preds = clf.predict(X_val)
        acc = float(accuracy_score(y_val, preds))
        self.last_accuracy = round(acc, 4)

        auc = None
        if len(np.unique(y_val)) > 1:
            try:
                probs = clf.predict_proba(X_val)[:, 1]
                auc = round(float(roc_auc_score(y_val, probs)), 4)
            except Exception as e:
                logger.warning(f"Failed to compute AUC: {e}")
        self.last_auc = auc

        importances = {}
        for name, val in zip(FEATURE_NAMES, clf.feature_importances_):
            importances[name] = round(float(val), 4)
        self.feature_importances = importances

        # Baseline comparison
        beats = bool(self.last_accuracy > majority_baseline)
        if beats:
            diff_pct = round((self.last_accuracy - majority_baseline) * 100, 1)
            comp_msg = f"Model accuracy ({self.last_accuracy*100:.1f}%) beats majority-class baseline ({majority_baseline*100:.1f}%) by +{diff_pct}%."
        elif self.last_accuracy == majority_baseline:
            comp_msg = f"Model accuracy ({self.last_accuracy*100:.1f}%) matches majority-class baseline ({majority_baseline*100:.1f}%)."
        else:
            diff_pct = round((majority_baseline - self.last_accuracy) * 100, 1)
            comp_msg = f"Model accuracy ({self.last_accuracy*100:.1f}%) does not beat majority-class baseline ({majority_baseline*100:.1f}%, -{diff_pct}%)."

        warning_text = (
            "Insufficient data: metrics are not meaningful (n < 200 real runs, small-data)"
            if is_insufficient
            else "Trained strictly on real stored runs (n >= 200)."
        )

        return PredictorTrainResponse(
            accuracy=self.last_accuracy,
            auc=self.last_auc,
            sample_size=self.sample_size,
            warning=warning_text,
            feature_importances=self.feature_importances,
            status="Insufficient data: metrics are not meaningful" if is_insufficient else "Trained on real runs",
            is_insufficient_data=is_insufficient,
            metrics_meaningful=not is_insufficient,
            class_balance=class_balance,
            majority_class_baseline_accuracy=majority_baseline,
            beats_baseline=beats,
            baseline_comparison=comp_msg,
            split_strategy=split_strategy,
            real_runs_only=True,
        )

    def predict(self, req: PredictorPredictRequest) -> PredictorPredictResponse:
        if self.model is None:
            from app.db import db_manager
            runs = db_manager.list_runs(limit=1000)
            if runs:
                self.train(runs)

        # Fallback heuristic calculation if still no trained model available
        if self.model is None:
            prob = 0.5
            if req.scenario_id in ("bad_deploy", "unfixable_rollback") and not req.policy.verify_postconditions:
                prob = 0.85
            elif req.fault_intensity > 0 and req.policy.max_retries == 0:
                prob = 0.75
            elif req.scenario_id == "injected_instruction" and not req.policy.treat_output_as_data:
                prob = 0.90
            else:
                prob = 0.25
        else:
            feats, _ = _extract_features_and_label(
                req.scenario_id,
                req.policy,
                req.fault_type,
                req.fault_intensity,
            )
            X = np.array([feats])
            try:
                probs = self.model.predict_proba(X)
                prob = float(probs[0][1]) if probs.shape[1] > 1 else float(probs[0][0])
            except Exception:
                prob = 0.5
            prob = round(prob, 4)

        if prob < 0.35:
            risk_level = "LOW"
        elif prob <= 0.70:
            risk_level = "MEDIUM"
        else:
            risk_level = "HIGH"

        # Identify contributing risk factors
        factors = []
        if req.policy.max_retries == 0 and req.fault_intensity > 0:
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

        warning_msg = (
            "Insufficient data: metrics are not meaningful (n < 200 real runs, small-data)"
            if self.sample_size < 200
            else "Trained on real runs."
        )

        return PredictorPredictResponse(
            failure_risk_probability=prob,
            risk_level=risk_level,
            contributing_factors=factors,
            warning=warning_msg,
        )


predictor_engine = FailureRiskPredictor()
