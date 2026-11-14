"""Local health contract: token required, DB reported, no stack traces."""
from __future__ import annotations

import pytest

from conftest import HEADERS


def test_health_requires_token(client):
    response = client.get("/api/v1/health", headers={"Host": "127.0.0.1:8000", "X-MM-Token": ""})
    assert response.status_code == 401
    assert response.json()["detail"] == "unauthorized"


def test_health_reports_db(client, needs_db):
    response = client.get("/api/v1/health")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "ok"
    assert body["db"]["connected"] is True
    assert body["db"]["migration"] == "0002_seed_kb"
    assert body["db"]["pgvector"] == "0.8.6"
    assert body["rag"]["chunks"] == 30


def test_cross_origin_is_rejected(client):
    response = client.get(
        "/api/v1/health",
        headers={**HEADERS, "Origin": "https://evil.example"},
    )
    assert response.status_code == 403


def test_static_root_does_not_require_token(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "MindMeter" in response.text
