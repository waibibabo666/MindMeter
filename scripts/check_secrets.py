#!/usr/bin/env python3
"""Scan tracked text files for likely committed secrets.

This is a lightweight guard, not a replacement for GitHub secret scanning.
Runs locally and in CI; stdlib only.

Usage:
    python scripts/check_secrets.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

TEXT_SUFFIXES = {
    ".md", ".html", ".htm", ".js", ".mjs", ".cjs", ".css",
    ".yml", ".yaml", ".py", ".json", ".toml", ".ini", ".cfg",
    ".txt", ".sql", ".env", ".example",
}
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build", "coverage", ".pytest_cache", "vendor", "runtime", "pgdata", "models"}

PATTERNS = [
    ("OpenAI-style API key", re.compile(r"\bsk-[A-Za-z0-9_-]{20,}\b")),
    ("GitHub token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}\b")),
    ("AWS access key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("Private key block", re.compile(r"-----BEGIN (?:RSA|EC|OPENSSH|DSA|PGP) PRIVATE KEY-----")),
    ("Postgres URL with password", re.compile(r"postgres(?:ql)?://[^\s:@/]+:[^\s@/]+@")),
    ("JWT-looking token", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")),
]


def iter_text_files():
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        yield path


def redact(value: str) -> str:
    value = value.strip()
    if len(value) <= 12:
        return value[:4] + "***"
    return value[:6] + "..." + value[-4:]


def main() -> int:
    findings = []
    scanned = 0
    for path in iter_text_files():
        scanned += 1
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError as exc:
            findings.append((path, 0, "read error", str(exc)))
            continue
        for line_no, line in enumerate(text.splitlines(), 1):
            for label, pattern in PATTERNS:
                match = pattern.search(line)
                if match:
                    findings.append((path, line_no, label, redact(match.group(0))))

    print(f"scanned text files: {scanned}")
    if findings:
        print("\nPOSSIBLE SECRETS FOUND:")
        for path, line_no, label, value in findings:
            print(f"  - {path.relative_to(ROOT)}:{line_no}: {label}: {value}")
        print("\nRemove the secret, rotate it, and use env vars / local .env (gitignored).")
        return 1

    print("OK: no obvious committed secrets")
    return 0


if __name__ == "__main__":
    sys.exit(main())
