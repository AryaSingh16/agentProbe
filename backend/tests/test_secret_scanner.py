"""
Secret Scanner Test:
Scans all cassettes, git-tracked files, trace exports, and .env.example to ensure
no real API keys or credentials were ever committed or recorded.
Confirms .env is in .gitignore and .dockerignore.
"""
import os
import re
import subprocess
from pathlib import Path
import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent

SECRET_PATTERNS = [
    re.compile(r"AIza[0-9A-Za-z-_]{35}"),
    re.compile(r"sk-[A-Za-z0-9]{20,}"),
    re.compile(r"AQ\.[0-9A-Za-z-_]{40,}"),
]


def test_no_secrets_in_cassettes():
    cassettes_dir = REPO_ROOT / "backend" / "cassettes"
    assert cassettes_dir.exists(), "cassettes directory must exist"

    violations = []
    for cassette_file in cassettes_dir.glob("*.json"):
        content = cassette_file.read_text(encoding="utf-8")
        for pat in SECRET_PATTERNS:
            match = pat.search(content)
            if match:
                violations.append(f"Secret matched in cassette {cassette_file.name}: {match.group()[:6]}...")

    assert not violations, f"API Key leaked in cassettes:\n" + "\n".join(violations)


def test_env_example_has_empty_key():
    example_path = REPO_ROOT / ".env.example"
    assert example_path.exists(), ".env.example must exist"
    content = example_path.read_text(encoding="utf-8")

    # Ensure no actual key is present in .env.example
    for pat in SECRET_PATTERNS:
        assert not pat.search(content), "Real API key leaked in .env.example!"

    # Must contain LLM_API_KEY= with empty value
    found_empty = False
    for line in content.splitlines():
        if line.strip().startswith("LLM_API_KEY="):
            val = line.strip().split("=", 1)[1]
            assert val == "", f"LLM_API_KEY in .env.example must be empty, found: {val}"
            found_empty = True
    assert found_empty, ".env.example must define LLM_API_KEY="


def test_env_is_gitignored_and_dockerignored():
    gitignore_path = REPO_ROOT / ".gitignore"
    assert gitignore_path.exists()
    gitignore_lines = [l.strip() for l in gitignore_path.read_text(encoding="utf-8").splitlines()]
    assert any(line == ".env" or line.startswith(".env") for line in gitignore_lines), ".env must be in .gitignore"

    dockerignore_path = REPO_ROOT / ".dockerignore"
    assert dockerignore_path.exists()
    dockerignore_lines = [l.strip() for l in dockerignore_path.read_text(encoding="utf-8").splitlines()]
    assert any(line == ".env" or line.startswith(".env") for line in dockerignore_lines), ".env must be in .dockerignore"


def test_no_secrets_in_git_tracked_files():
    try:
        tracked_files = subprocess.check_output(
            ["git", "ls-files"], cwd=str(REPO_ROOT), text=True
        ).splitlines()
    except Exception:
        # Fallback if git binary not in PATH
        tracked_files = []
        for root, _, files in os.walk(REPO_ROOT):
            if ".git" in root or ".venv" in root or "node_modules" in root:
                continue
            for f in files:
                tracked_files.append(str(Path(root) / f))

    violations = []
    for fpath_str in tracked_files:
        fpath = REPO_ROOT / fpath_str
        # Skip this test file itself as it defines regex patterns
        if "test_secret_scanner.py" in str(fpath):
            continue
        if not fpath.is_file() or fpath.suffix in (".png", ".jpg", ".ico", ".db", ".sqlite"):
            continue

        try:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
            for pat in SECRET_PATTERNS:
                match = pat.search(content)
                if match:
                    violations.append(f"Secret pattern found in tracked file {fpath_str}: {match.group()[:6]}...")
        except Exception:
            pass

    assert not violations, f"Secret pattern matched in git-tracked files:\n" + "\n".join(violations)
