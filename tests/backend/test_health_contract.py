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
    assert body["db"]["migration"] in {"0002_seed_kb", "0003_chat_risk"}
    # CI uses pgvector/pgvector:pg17 (currently 0.8.7); local vendor is 0.8.6.
    version = str(body["db"]["pgvector"] or "")
    parts = tuple(int(part) for part in version.split(".")[:3])
    assert parts >= (0, 8, 6), f"unexpected pgvector version: {version}"
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
