"""OpenAPI surface for the single-user local desktop API."""
from __future__ import annotations

import re

import pytest

app_module = pytest.importorskip("app.main")
app = app_module.app

PARAM_RE = re.compile(r"\{[^}]+\}")

EXPECTED_PATHS = [
    "/api/v1/health",
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
    "/api/v1/memory/advice",
    "/api/v1/settings/ai",
    "/api/v1/settings/ai/key",
    "/api/v1/settings/ai/test",
    "/api/v1/export",
    "/api/v1/import",
    "/api/v1/data",
    "/api/v1/logs",
]


def normalize(path: str) -> str:
    return PARAM_RE.sub("{}", path)


def test_local_openapi_paths_present():
    paths = {normalize(path) for path in app.openapi().get("paths", {})}
    missing = [path for path in EXPECTED_PATHS if path not in paths]
    assert not missing, "missing OpenAPI paths: " + ", ".join(missing)


def test_no_account_or_jwt_endpoints():
    paths = set(app.openapi().get("paths", {}))
    for forbidden in ("/api/v1/auth/login", "/api/v1/auth/register", "/api/v1/me"):
        assert forbidden not in paths
