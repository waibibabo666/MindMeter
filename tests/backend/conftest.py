"""Backend test fixtures.

Integration tests use a real PostgreSQL/pgvector database, never SQLite.
Set MM_TEST_DATABASE_URL to a disposable database URL to enable them.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[2] / "code" / "backend"
if BACKEND.is_dir() and str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

os.environ.setdefault("MM_API_TOKEN", "test-token")
os.environ.setdefault("MM_RAG_MODE", "keyword")
os.environ.setdefault("MM_DATA_DIR", str(Path(__file__).resolve().parents[2] / "runtime" / "pytest-data"))
if os.environ.get("MM_TEST_DATABASE_URL"):
    os.environ["MM_DATABASE_URL"] = os.environ["MM_TEST_DATABASE_URL"]

HEADERS = {"X-MM-Token": os.environ["MM_API_TOKEN"], "Host": "127.0.0.1:8000"}


@pytest.fixture(scope="session")
def client():
    fastapi_testclient = pytest.importorskip("fastapi.testclient")
    from app.main import app

    with fastapi_testclient.TestClient(
        app, client=("127.0.0.1", 50000), headers=HEADERS
    ) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def needs_db():
    if not os.environ.get("MM_TEST_DATABASE_URL"):
        pytest.skip("MM_TEST_DATABASE_URL not set")
