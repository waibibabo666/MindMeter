"""OpenAPI surface contract for the L2 backend.

Skipped until `code/backend/app/main.py` exists. Path parameter names are
normalized so `{assessment_id}` and `{id}` both match `{}`.
"""
# pylint: disable=missing-function-docstring
from __future__ import annotations

import re

import pytest

app_module = pytest.importorskip("app.main", reason="backend not scaffolded yet")
app = app_module.app

PARAM_RE = re.compile(r"\{[^}]+\}")

EXPECTED_PATHS = [
    "/api/v1/auth/register",
    "/api/v1/auth/login",
    "/api/v1/auth/refresh",
    "/api/v1/auth/logout",
    "/api/v1/me",
    "/api/v1/me/export",
    "/api/v1/assessments",
    "/api/v1/assessments/{}",
    "/api/v1/assessments/{}/submit",
    "/api/v1/reports/{}",
    "/api/v1/trends",
    "/api/v1/threads",
    "/api/v1/threads/{}/messages",
    "/api/v1/memory/profile",
    "/api/v1/memory/summaries",
    "/api/v1/memory",
    "/api/v1/settings/ai",
    "/api/v1/health",
]


def normalize(path: str) -> str:
    return PARAM_RE.sub("{}", path)


def test_core_openapi_paths_present():
    paths = {normalize(p) for p in app.openapi().get("paths", {})}
    missing = [p for p in EXPECTED_PATHS if p not in paths]
    assert not missing, "missing OpenAPI paths: " + ", ".join(missing)
