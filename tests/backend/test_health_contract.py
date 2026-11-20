"""Hosted health/transport contract: what is public, what is guarded, what headers ship."""
from __future__ import annotations

from conftest import unique_username


def test_liveness_needs_no_database(client):
    response = client.get("/api/v1/health/live")
    assert response.status_code == 200
    assert response.json()["status"] == "alive"


def test_readiness_is_public_without_session(client, needs_db):
    response = client.get("/api/v1/health")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "ok"
    assert body["db"]["connected"] is True
    assert body["db"]["migration"] in {"0004_hosted_copy", "0005_profile"}
    version = str(body["db"]["pgvector"] or "")
    parts = tuple(int(part) for part in version.split(".")[:3])
    assert parts >= (0, 8, 6), f"unexpected pgvector version: {version}"
    assert body["rag"]["chunks"] == 30
    assert isinstance(body["ai"]["enabled"], bool)
    assert isinstance(body["users"], int)


def test_static_root_needs_no_session(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "MindMeter" in response.text


def test_security_headers_on_every_response(client):
    for path in ("/", "/api/v1/health/live"):
        headers = client.get(path).headers
        assert headers["x-content-type-options"] == "nosniff"
        assert headers["x-frame-options"] == "DENY"
        assert "frame-ancestors 'none'" in headers["content-security-policy"]
        assert "script-src 'self'" in headers["content-security-policy"]


def test_api_responses_are_not_cached(client):
    headers = client.get("/api/v1/health/live").headers
    assert headers["cache-control"] == "no-store"
    assert "Cookie" in headers["vary"]


def test_anonymous_data_call_is_rejected(client, needs_db):
    response = client.get("/api/v1/state")
    assert response.status_code == 401
    assert response.json()["detail"] == "unauthenticated"


def test_cross_origin_write_is_rejected(logged_client):
    response = logged_client.post(
        "/api/v1/chat/messages",
        json={"content": "hi"},
        headers={"Origin": "https://evil.example"},
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "invalid_origin"


def test_non_json_body_is_rejected(logged_client):
    response = logged_client.post("/api/v1/chat/messages", data={"content": "hi"})
    assert response.status_code == 415
    assert response.json()["detail"] == "json_body_required"


def test_same_origin_write_succeeds(logged_client):
    response = logged_client.post(
        "/api/v1/chat/messages",
        json={"content": "同源写入应当成功"},
        headers={"Origin": "http://testserver"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["id"]


def test_registration_can_be_closed(app_instance, monkeypatch):
    from app.config import settings
    from conftest import _testclient

    monkeypatch.setattr(settings, "allow_registration", False)
    client = _testclient(app_instance)
    response = client.post(
        "/api/v1/auth/register",
        json={"username": unique_username("closed"), "password": "abcdef12345", "adult": True},
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "registration_disabled"
