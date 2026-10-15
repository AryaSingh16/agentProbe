"""
Offline tests for Live LLM mode:
- Live mode without key falls back with clear message and no crash.
- Mocked 429 never creates failed run in matrix.
- Cassettes and exports contain no key-like strings or error responses.
"""
import json
import os
import re
from unittest.mock import MagicMock, patch
import pytest
from fastapi.testclient import TestClient

from app.grader import DeterministicGrader
from app.main import app
from app.runner import run_experiment
from app.schemas import RunCreateRequest, Verdict, FailureClass
import app.llm as llm_module

client = TestClient(app)


def test_live_mode_without_key_falls_back_cleanly(monkeypatch):
    """Live mode without key falls back with clear message and no crash."""
    monkeypatch.setattr(llm_module, "LLM_API_KEY", "")
    req = RunCreateRequest(
        scenario_id="healthy_service",
        agent_type="llm-live",
        fault_type=None,
        seed=42,
    )
    res = run_experiment(req)
    assert res is not None
    assert res.grader_result.verdict == Verdict.NOT_COMPLETED
    assert res.grader_result.failure_class == FailureClass.AGENT_ERROR.value
    reasons = " ".join(res.grader_result.failure_reasons).lower()
    assert "no api key" in reasons or "not completed" in reasons


def test_mocked_429_never_creates_failed_run_in_matrix(monkeypatch):
    """Mocked 429 after retries marks run Not completed and never creates a failed run in matrix."""
    monkeypatch.setattr(llm_module, "LLM_API_KEY", "fake-test-key")
    monkeypatch.setattr(llm_module, "_LIVE_REQUEST_TIMESTAMPS", [])

    mock_resp = MagicMock()
    mock_resp.status_code = 429
    mock_resp.headers = {"Retry-After": "0.01"}

    with patch("httpx.Client.post", return_value=mock_resp), patch("time.sleep", return_value=None):
        req = RunCreateRequest(
            scenario_id="bad_deploy",
            agent_type="llm-live",
            fault_type=None,
            seed=42,
        )
        res = run_experiment(req)

        assert res.grader_result.verdict == Verdict.NOT_COMPLETED
        assert res.grader_result.failure_class == FailureClass.AGENT_ERROR.value

        # Confirm that dataset analysis / matrix ignores this run or does not count it as failed
        run_dict = res.model_dump()
        analysis = DeterministicGrader.compute_dataset_analysis([run_dict])
        details = analysis["matrix_details"]["llm"]["none"]
        assert details["total"] == 0
        assert details["passed"] == 0


def test_cassettes_and_exports_contain_no_secrets_or_errors():
    """Cassettes and exports contain no key-like strings or error responses."""
    cassettes_dir = llm_module.CASSETTES_DIR
    secret_pattern = re.compile(r"AIza[0-9A-Za-z-_]{35}|Bearer\s+[A-Za-z0-9_\-\.]{20,}")
    error_markers = ["LLM_ERROR", "HTTP_429", "RATE_LIMIT_EXCEEDED"]

    if cassettes_dir.exists():
        for cassette_file in cassettes_dir.glob("*.json"):
            content = cassette_file.read_text(encoding="utf-8")
            assert not secret_pattern.search(content), f"Secret found in cassette {cassette_file.name}"
            for marker in error_markers:
                assert marker not in content, f"Error marker '{marker}' found in cassette {cassette_file.name}"

    res = client.get("/api/export/runs.json")
    assert res.status_code == 200
    export_text = res.text
    assert not secret_pattern.search(export_text), "Secret found in /api/export/runs.json"
    assert "LLM_API_KEY" not in export_text
