"""
AgentProbe Failure-Risk Predictor:
Trains a scikit-learn classifier on run traces (scenario, policy, fault type, fault count).
Computes holdout accuracy, AUC, and feature importances.
Reports prominent warning: 'small-data, not validated for production use'.
"""
import copy
import logging
from typing import Any, Dict, List, Optional, Tuple
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, roc_auc_score
from sklearn.model_selection import train_test_split

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


FEATURE_NAMES = [
    "scenario_id",
    "policy_max_retries",
    "policy_validate_schema",
    "policy_treat_output_as_data",
    "policy_verify_postconditions",
    "fault_type",
    "fault_intensity",
]


class FailureRiskPredictor:
    def __init__(self):
        self.model: Optional[RandomForestClassifier] = None
        self.sample_size: int = 0
        self.last_accuracy: float = 0.0
        self.last_auc: Optional[float] = None
        self.feature_importances: Dict[str, float] = {}

    def _generate_synthetic_baseline(self) -> Tuple[np.ndarray, np.ndarray]:
        """
        Provides synthetic ground-truth permutations of our deterministic domain logic
        so the classifier can train even when few stored runs exist.
        """
        X = []
        y = []
        scenarios = list(SCENARIO_MAP.keys())
        fault_types = list(FAULT_TYPE_MAP.keys())

        # Permutations across policies
        policies = [
            # Naive
            PolicyConfig(max_retries=0, validate_schema=False, treat_output_as_data=False, verify_postconditions=False),
            # Semi-robust
            PolicyConfig(max_retries=3, validate_schema=False, treat_output_as_data=False, verify_postconditions=False),
            PolicyConfig(max_retries=0, validate_schema=True, treat_output_as_data=True, verify_postconditions=True),
            # Fully robust
            PolicyConfig(max_retries=3, validate_schema=True, treat_output_as_data=True, verify_postconditions=True),
        ]

        for s in scenarios:
            for p in policies:
                for ft in fault_types:
                    for intensity in [0, 1, 2, 3]:
                        # Predict expected outcome using deterministic rules
                        fails = False
                        if s == "rollback_denied" and not p.treat_output_as_data and p.max_retries == 0:
                            fails = True
                        if s == "injected_instruction" and not p.treat_output_as_data:
                            fails = True
                        if s == "unfixable_rollback":
                            fails = True  # Failed recovery is never success
                        if ft in ("timeout", "http_500", "transient_then_success") and intensity > 0 and p.max_retries == 0:
                            fails = True
                        if ft in ("malformed_json", "empty_response") and intensity > 0 and not p.validate_schema:
                            fails = True
                        if s == "bad_deploy" and not p.verify_postconditions:
                            fails = True

                        feats, _ = _extract_features_and_label(s, p, ft, intensity)
                        X.append(feats)
                        y.append(1 if fails else 0)

        return np.array(X), np.array(y)

    def train(self, runs: List[RunResponse]) -> PredictorTrainResponse:
        X_list = []
        y_list = []

        # Extract features from stored runs
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

        # Supplement with synthetic baseline if stored runs are sparse
        if len(X_list) < 40:
            X_syn, y_syn = self._generate_synthetic_baseline()
            if X_list:
                X_arr = np.vstack([np.array(X_list), X_syn])
                y_arr = np.concatenate([np.array(y_list), y_syn])
            else:
                X_arr, y_arr = X_syn, y_syn
        else:
            X_arr = np.array(X_list)
            y_arr = np.array(y_list)

        self.sample_size = len(y_arr)

        # Train / holdout split
        X_train, X_val, y_train, y_val = train_test_split(
            X_arr, y_arr, test_size=0.25, random_state=42, stratify=y_arr if len(np.unique(y_arr)) > 1 else None
        )

        clf = RandomForestClassifier(n_estimators=50, max_depth=6, random_state=42)
        clf.fit(X_train, y_train)
        self.model = clf

        preds = clf.predict(X_val)
        acc = float(accuracy_score(y_val, preds))
        self.last_accuracy = round(acc, 4)

        # Calculate AUC if both classes exist in validation set
        auc = None
        if len(np.unique(y_val)) > 1:
            probs = clf.predict_proba(X_val)[:, 1]
            auc = round(float(roc_auc_score(y_val, probs)), 4)
        self.last_auc = auc

        # Feature importances
        importances = {}
        for name, val in zip(FEATURE_NAMES, clf.feature_importances_):
            importances[name] = round(float(val), 4)
        self.feature_importances = importances

        return PredictorTrainResponse(
            accuracy=self.last_accuracy,
            auc=self.last_auc,
            sample_size=self.sample_size,
            warning="small-data, not validated for production use",
            feature_importances=self.feature_importances,
        )

    def predict(self, req: PredictorPredictRequest) -> PredictorPredictResponse:
        if self.model is None:
            # Auto-train baseline if called before explicit train
            self.train([])

        feats, _ = _extract_features_and_label(
            req.scenario_id,
            req.policy,
            req.fault_type,
            req.fault_intensity,
        )
        X = np.array([feats])

        prob = float(self.model.predict_proba(X)[0][1])
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

        return PredictorPredictResponse(
            failure_risk_probability=prob,
            risk_level=risk_level,
            contributing_factors=factors,
            warning="small-data, not validated for production use",
        )


predictor_engine = FailureRiskPredictor()
