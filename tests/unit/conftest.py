"""Unit-test bootstrap: pure logic only, no database or HTTP fixture."""
from __future__ import annotations

import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2] / "code" / "backend"
if BACKEND.is_dir() and str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

os.environ.setdefault("MM_AUTO_MIGRATE", "0")
os.environ.setdefault(
    "MM_DATA_DIR", str(Path(__file__).resolve().parents[2] / "runtime" / "pytest-data")
)
