#!/usr/bin/env python3
"""Repository documentation / structure checks.

Runs locally and in GitHub Actions; stdlib only.

Usage:
    python scripts/check_docs.py
"""
from __future__ import annotations

import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

REQUIRED_FILES = [
    "README.md",
    "docs/README.md",
    "docs/requirements/problem_definition.md",
    "docs/requirements/functional_spec.md",
    "docs/requirements/nonfunctional_spec.md",
    "docs/requirements/xlragentdesign.md",
    "docs/algorithm/algorithm.md",
    "docs/software/architecture.md",
    "docs/software/software.md",
    "docs/research/user_stories.md",
    "docs/software/prototype/prototype.md",
    "docs/software/prototype/agent-接入位.md",
    "docs/software/prototype/index.html",
    "docs/mgmt/communication_mgmt_plan.md",
    "docs/mgmt/risk_mgmt_plan.md",
    "docs/mgmt/task_breakdown.md",
    "docs/mgmt/m1_scope.md",
    "docs/mgmt/ai_collaboration.md",
    "docs/mgmt/issue_import.md",
    "docs/mgmt/issues.csv",
    "docs/retrospection/retrospection.md",
    "code/backend/README.md",
    "code/frontend/README.md",
    "code/core_engine/README.md",
    "code/ai/README.md",
    "tests/README.md",
    "tests/backend/README.md",
    "scripts/check_docs.py",
    "scripts/check_secrets.py",
    "scripts/test_prototype.js",
    "scripts/test_app_shell.js",
    "scripts/test_storage.js",
    "scripts/test_llm_client.js",
    "scripts/test_report_trend.js",
    "scripts/test_units.js",
    "scripts/export_issues.py",
    "scripts/create_issues.py",
    "package.json",
    "package-lock.json",
    "eslint.config.mjs",
    "eslint.complexity.config.mjs",
    "playwright.config.mjs",
    "tests/e2e/app.spec.js",
    ".prettierrc.json",
    ".prettierignore",
    ".github/ISSUE_TEMPLATE/task.md",
    ".github/ISSUE_TEMPLATE/bug.md",
    ".github/ISSUE_TEMPLATE/config.yml",
    ".github/workflows/ci.yml",
    ".github/workflows/structure-check.yml",
]

REQUIRED_DIRS = [
    "docs/requirements",
    "docs/research",
    "docs/algorithm",
    "docs/software",
    "docs/software/prototype",
    "docs/mgmt",
    "docs/retrospection",
    "code/backend",
    "code/frontend",
    "code/core_engine",
    "code/ai",
    "tests/unit",
    "tests/integration",
    "tests/backend",
    "scripts",
    ".github/workflows",
]

TEXT_SUFFIXES = {
    ".md", ".html", ".htm", ".js", ".mjs", ".cjs", ".css",
    ".yml", ".yaml", ".py", ".json", ".toml", ".ini", ".cfg",
    ".txt", ".sql",
}
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build", "coverage"}
CONFLICT_RE = re.compile(r"^(<<<<<<<|=======|>>>>>>>)", re.MULTILINE)
LINK_RE = re.compile(r"\]\(([^)]+)\)")


def iter_files(root: Path):
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        yield path


def check_required():
    errors = []
    for rel in REQUIRED_FILES:
        if not (ROOT / rel).is_file():
            errors.append(f"missing file: {rel}")
    for rel in REQUIRED_DIRS:
        if not (ROOT / rel).is_dir():
            errors.append(f"missing directory: {rel}")
    return errors


def check_submission_files():
    errors = []
    folder = ROOT / "work_for_submission"
    for i in (1, 2, 3):
        direct = folder / f"{i}.md"
        if direct.is_file():
            continue
        matches = [
            p for p in folder.glob("*.md")
            if "assignment" in p.name and f"[{i}]" in p.name and p.name.endswith("_rev.md")
        ]
        if not matches:
            errors.append(f"missing submission file: work_for_submission/{i}.md (or assignment[{i}]_rev.md)")
    return errors


def check_conflicts():
    errors = []
    for path in iter_files(ROOT):
        if path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            errors.append(f"{path.relative_to(ROOT)}: cannot read ({exc})")
            continue
        for match in CONFLICT_RE.finditer(text):
            line = text.count("\n", 0, match.start()) + 1
            errors.append(f"{path.relative_to(ROOT)}:{line}: conflict marker {match.group(1)}")
    return errors


def check_markdown_links():
    errors = []
    checked = 0
    for path in iter_files(ROOT):
        if path.suffix.lower() != ".md":
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for match in LINK_RE.finditer(text):
            target = match.group(1).strip()
            if not target or target.startswith(("http://", "https://", "#", "mailto:")):
                continue
            if target.startswith("<") and target.endswith(">"):
                target = target[1:-1].strip()
            target = target.split("#", 1)[0].strip()
            if not target:
                continue
            resolved = (path.parent / target).resolve()
            checked += 1
            if not resolved.exists():
                errors.append(f"{path.relative_to(ROOT)} -> {match.group(1)}")
    return errors, checked


def check_duplicates():
    """Fail on byte-identical .md/.html files (copy/paste docs are a common bug)."""
    errors = []
    groups: dict[str, list[str]] = {}
    for path in iter_files(ROOT):
        if path.suffix.lower() not in {".md", ".html", ".htm"}:
            continue
        digest = hashlib.md5(path.read_bytes()).hexdigest()
        groups.setdefault(digest, []).append(str(path.relative_to(ROOT)))
    for digest, paths in groups.items():
        if len(paths) > 1:
            errors.append("duplicate files: " + ", ".join(sorted(paths)))
    return errors


def main() -> int:
    errors: list[str] = []
    errors.extend(check_required())
    errors.extend(check_submission_files())
    errors.extend(check_conflicts())
    link_errors, link_count = check_markdown_links()
    errors.extend(link_errors)
    errors.extend(check_duplicates())

    print(f"root: {ROOT}")
    print(f"required docs/dirs: {len(REQUIRED_FILES)} files, {len(REQUIRED_DIRS)} dirs")
    print(f"markdown links checked: {link_count}")

    if errors:
        print("\nFAILED:")
        for err in errors:
            print(f"  - {err}")
        return 1

    print("OK: structure, links and duplicate checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
