"""Minimal health contract for the future FastAPI backend.

Skipped until `code/backend/app/main.py` exists.
"""
from __future__ import annotations

import pytest

pytest.importorskip("app.main", reason="backend not scaffolded yet")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


def test_health_endpoint():
    with TestClient(app) as client:
        response = client.get("/api/v1/health")

    assert response.status_code == 200, response.text
    body = response.json()
    assert str(body.get("status", "")).lower() in {"ok", "healthy"}
