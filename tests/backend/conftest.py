"""Backend test fixtures.

Integration tests use a real PostgreSQL/pgvector database, never SQLite.
Set MM_TEST_DATABASE_URL to a disposable database URL to enable them (the
database must already be migrated: `alembic upgrade head`).

The hosted build is cookie-authenticated, so there are three shapes of client:

* `client`       — anonymous, no database needed (health, OpenAPI, auth errors);
* `logged_client`— one shared account, session-scoped, for the data suites;
* `register_account(app)` — a factory that returns a *second* signed-in client,
  which is what the tenancy-isolation tests need.
"""
from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[2] / "code" / "backend"
if BACKEND.is_dir() and str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

os.environ.setdefault("MM_RAG_MODE", "keyword")
os.environ.setdefault("MM_DATA_DIR", str(Path(__file__).resolve().parents[2] / "runtime" / "pytest-data"))
os.environ.setdefault("MM_ALLOW_REGISTRATION", "true")
os.environ.setdefault("MM_COOKIE_SECURE", "false")
os.environ.setdefault("MM_AUTO_MIGRATE", "0")
# The suite mints many throwaway accounts from one client ip; the shipped
# default (50/hour) is what a real deployment gets, not what tests need.
os.environ.setdefault("MM_REGISTER_MAX_ATTEMPTS", "5000")
if os.environ.get("MM_TEST_DATABASE_URL"):
    os.environ["MM_DATABASE_URL"] = os.environ["MM_TEST_DATABASE_URL"]

PASSWORD = "pytest-passw0rd"
BASE_URL = "http://testserver"

# Cookie auth: no shared header. Kept so older test modules still import cleanly.
HEADERS: dict[str, str] = {}


def _testclient(app):
    fastapi_testclient = pytest.importorskip("fastapi.testclient")
    return fastapi_testclient.TestClient(app, base_url=BASE_URL)


@pytest.fixture(scope="session")
def app_instance():
    from app.main import app

    return app


@pytest.fixture(scope="session")
def client(app_instance):
    with _testclient(app_instance) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def needs_db():
    if not os.environ.get("MM_TEST_DATABASE_URL"):
        pytest.skip("MM_TEST_DATABASE_URL not set")


def unique_username(prefix: str = "u") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def register_account(app, username: str | None = None, password: str = PASSWORD):
    """Create an account and return (signed-in client, username, password)."""
    name = username or unique_username()
    test_client = _testclient(app)
    response = test_client.post(
        "/api/v1/auth/register",
        json={"username": name, "password": password, "adult": True},
    )
    assert response.status_code == 200, response.text
    return test_client, name, password


@pytest.fixture(scope="session")
def logged_client(app_instance, needs_db):
    """One account shared by the data suites (they are ordered by file, not by id)."""
    test_client, username, password = register_account(app_instance)
    test_client.account = {"username": username, "password": password}
    yield test_client


@pytest.fixture()
def fresh_client(app_instance, needs_db):
    """A second, independent signed-in account for tenancy tests."""
    test_client, username, password = register_account(app_instance)
    test_client.account = {"username": username, "password": password}
    yield test_client
