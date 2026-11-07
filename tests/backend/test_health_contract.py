"""Minimal health contract for the future FastAPI backend.

Skipped until `code/backend/app/main.py` exists.
"""
# pylint: disable=missing-function-docstring
from __future__ import annotations

import pytest

app_module = pytest.importorskip("app.main", reason="backend not scaffolded yet")
app = app_module.app

testclient_module = pytest.importorskip("fastapi.testclient", reason="fastapi not installed")
TestClient = testclient_module.TestClient


def test_health_endpoint():
    with TestClient(app) as client:
        response = client.get("/api/v1/health")

    assert response.status_code == 200, response.text
    body = response.json()
    assert str(body.get("status", "")).lower() in {"ok", "healthy"}
