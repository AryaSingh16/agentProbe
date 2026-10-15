"""
Automated Claims and Overstatement Audit Test:
Scans codebase (backend/app, frontend/src, README, finetune) to ensure banned overclaim
phrases do not appear outside the designated 'What is and isn't claimed' section.
Banned phrases: 'fine-tuned', 'LLM-tested', 'production-ready', 'proves'.
"""
import os
import re
from pathlib import Path
import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent

BANNED_PATTERNS = [
    re.compile(r"\bfine-tuned\b", re.IGNORECASE),
    re.compile(r"\bLLM-tested\b", re.IGNORECASE),
    re.compile(r"\bproduction-ready\b", re.IGNORECASE),
    re.compile(r"\bproves\b", re.IGNORECASE),
]


def test_no_banned_overclaims_in_codebase():
    """
    Checks that banned overclaim phrases do not appear in code, UI, or docs
    outside the honest 'What is and isn't claimed' section of README.
    """
    violations = []

    # Directories to inspect
    target_dirs = [
        REPO_ROOT / "backend" / "app",
        REPO_ROOT / "frontend" / "src",
        REPO_ROOT / "finetune",
    ]

    for target_dir in target_dirs:
        if not target_dir.exists():
            continue
        for root, _, files in os.walk(target_dir):
            for file in files:
                if file.endswith((".py", ".ts", ".tsx", ".md", ".json")) and not file.endswith(".test.tsx"):
                    file_path = Path(root) / file
                    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                        for line_num, line in enumerate(f, start=1):
                            # Skip explicit honest disclaimers in comments/docs
                            if "optional lora workflow, not executed" in line.lower() or "no model was fine-tuned" in line.lower():
                                continue
                            for pat in BANNED_PATTERNS:
                                if pat.search(line):
                                    violations.append(
                                        f"{file_path.relative_to(REPO_ROOT)}:{line_num} -> {line.strip()}"
                                    )

    # Check README.md for banned overclaim phrases
    readme_path = REPO_ROOT / "README.md"
    if readme_path.exists():
        with open(readme_path, "r", encoding="utf-8") as f:
            for line_num, line in enumerate(f, start=1):
                # Disclaimers are permitted
                if "not executed" in line.lower() or "not evaluated" in line.lower():
                    continue
                for pat in BANNED_PATTERNS:
                    if pat.search(line):
                        violations.append(
                            f"README.md:{line_num} -> {line.strip()}"
                        )

    assert not violations, f"Found banned overclaim phrases in codebase:\n" + "\n".join(violations)
