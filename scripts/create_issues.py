#!/usr/bin/env python3
"""Create GitHub issues from docs/mgmt/issues.csv using the `gh` CLI.

Default is dry-run. Add --apply to actually create issues.
Labels and milestones must already exist in the repository.

Examples:
    python scripts/create_issues.py --dry-run --limit 5
    python scripts/create_issues.py --apply --limit 1
    python scripts/create_issues.py --apply --repo owner/name
"""
from __future__ import annotations

import argparse
import csv
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "docs" / "mgmt" / "issues.csv"


def load_rows() -> list[dict]:
    if not CSV_PATH.exists():
        raise SystemExit(f"missing {CSV_PATH.relative_to(ROOT)}; run: python scripts/export_issues.py")
    with CSV_PATH.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    if not rows:
        raise SystemExit("issues.csv is empty")
    return rows


def build_command(row: dict, repo: str | None) -> list[str]:
    command = ["gh", "issue", "create", "--title", row["Title"], "--body", row["Body"]]
    if repo:
        command.extend(["--repo", repo])
    for label in [x.strip() for x in row.get("Labels", "").split(",") if x.strip()]:
        command.extend(["--label", label])
    if row.get("Assignees", "").strip():
        command.extend(["--assignee", row["Assignees"].strip()])
    if row.get("Milestone", "").strip():
        command.extend(["--milestone", row["Milestone"].strip()])
    return command


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="actually create issues (default: dry-run)")
    parser.add_argument("--dry-run", action="store_true", help="preview only (default)")
    parser.add_argument("--limit", type=int, default=0, help="create only the first N rows (0 = all)")
    parser.add_argument("--start", type=int, default=0, help="skip the first N rows")
    parser.add_argument("--repo", default=None, help="owner/name; defaults to current gh repo")
    args = parser.parse_args()

    if args.apply and args.dry_run:
        parser.error("choose either --apply or --dry-run")

    rows = load_rows()
    selected = rows[args.start:]
    if args.limit > 0:
        selected = selected[: args.limit]

    if args.apply:
        if not shutil.which("gh"):
            print("gh CLI not found. Install GitHub CLI and run `gh auth login`.")
            return 1
        auth = subprocess.run(["gh", "auth", "status"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if auth.returncode != 0:
            print("gh is not authenticated. Run `gh auth login` first.")
            return 1

    print(f"{'CREATE' if args.apply else 'DRY-RUN'}: {len(selected)} issue(s)")
    failures = 0
    for index, row in enumerate(selected, start=args.start + 1):
        command = build_command(row, args.repo)
        if not args.apply:
            print(f"  {index:02d}. {row['Title']}")
            print(f"      labels={row.get('Labels','')} assignee={row.get('Assignees','')} milestone={row.get('Milestone','')}")
            continue
        result = subprocess.run(command, text=True, capture_output=True)
        if result.returncode == 0:
            print(f"  [ok] {row['Title']} -> {result.stdout.strip()}")
        else:
            failures += 1
            print(f"  [fail] {row['Title']}: {result.stderr.strip()}")

    if failures:
        print(f"\n{failures} issue(s) failed. Check labels/milestones/auth and retry.")
        return 1
    print("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
