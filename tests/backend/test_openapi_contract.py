"""Public API surface for the hosted multi-user web app."""
from __future__ import annotations

import re

import pytest

app_module = pytest.importorskip("app.main")
app = app_module.app

PARAM_RE = re.compile(r"\{[^}]+\}")

EXPECTED_PATHS = [
    # public
    "/api/v1/health",
    "/api/v1/health/live",
    "/api/v1/auth/session",
    "/api/v1/auth/register",
    "/api/v1/auth/login",
    # authenticated
    "/api/v1/auth/logout",
    "/api/v1/auth/me",
    "/api/v1/auth/password",
    "/api/v1/auth/account",
    "/api/v1/state",
    "/api/v1/assessments",
    "/api/v1/assessments/{}",
    "/api/v1/trends",
    "/api/v1/reports/{}",
    "/api/v1/reports/{}/explain",
    "/api/v1/chat",
    "/api/v1/chat/messages",
    "/api/v1/memory",
    "/api/v1/memory/profile",
    "/api/v1/memory/summaries",
    "/api/v1/memory/summaries/{}",
    "/api/v1/memory/advice",
    "/api/v1/memory/advice/{}",
    "/api/v1/settings/ai",
    "/api/v1/settings/ai/key",
    "/api/v1/settings/ai/test",
    "/api/v1/export",
    "/api/v1/import",
    "/api/v1/data",
    "/api/v1/logs",
]

# Deliberately absent: the session is an HttpOnly cookie, not a bearer token,
# and the model credential belongs to the deployment, not to a user.
FORBIDDEN_PATHS = [
    "/api/v1/auth/refresh",
    "/api/v1/auth/token",
    "/api/v1/admin/users",
    "/api/v1/settings/ai/key/rotate",
]


def normalize(path: str) -> str:
    return PARAM_RE.sub("{}", path)


def test_public_openapi_paths_present():
    paths = {normalize(path) for path in app.openapi().get("paths", {})}
    missing = [path for path in EXPECTED_PATHS if path not in paths]
    assert not missing, "missing OpenAPI paths: " + ", ".join(missing)


def test_no_token_or_admin_endpoints():
    paths = set(app.openapi().get("paths", {}))
    for forbidden in FORBIDDEN_PATHS:
        assert forbidden not in paths


def test_docs_stay_closed_in_production():
    assert app.docs_url is None
    assert app.redoc_url is None
    assert app.openapi_url is None
