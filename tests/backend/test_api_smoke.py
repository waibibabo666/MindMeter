"""Smoke tests against a disposable local PostgreSQL database."""
from __future__ import annotations

import uuid

import pytest

pytestmark = pytest.mark.usefixtures("needs_db")


def test_assessment_roundtrip_and_no_key_in_export(logged_client):
    assessment_id = f"s_pytest_{uuid.uuid4().hex[:8]}"
    session = {
        "id": assessment_id,
        "mode": "standard",
        "finishedAt": "2026-11-14T01:00:00Z",
        "dims": ["vc", "ps", "sv", "am"],
        "results": {
            "vc": {"metrics": {"total": 6, "correct": 6}, "answers": []},
            "ps": {"metrics": {"correct": 20}, "answers": []},
            "sv": {"metrics": {"total": 8, "correct": 8, "correctRts": [1500] * 8}, "answers": []},
            "am": {
                "metrics": {"hits": 8, "falseAlarms": 0},
                "answers": [{"isOld": True}] * 8 + [{"isOld": False}] * 8,
            },
        },
    }
    response = logged_client.post("/api/v1/assessments", json={"session": session})
    assert response.status_code == 200, response.text
    saved = response.json()["session"]
    assert saved["scores"]["vc"] == 100

    listed = logged_client.get("/api/v1/assessments").json()["sessions"]
    assert any(item["id"] == assessment_id for item in listed)

    exported = logged_client.get("/api/v1/export")
    assert exported.status_code == 200
    text = exported.text
    assert "apiKey" not in text
    assert not __import__("re").search(r"sk-[A-Za-z0-9_-]{8,}", text)

    settings = logged_client.get("/api/v1/settings/ai").json()
    assert "apiKey" not in settings
    assert "hasKey" in settings


def test_memory_replace_and_chat_template_fallback(logged_client):
    memory = {
        "profile": {"goal": "备考", "preference": "", "constraint": "", "confirmed": True},
        "summaries": [],
        "advice": [],
        "messages": [],
    }
    response = logged_client.put("/api/v1/memory", json=memory)
    assert response.status_code == 200, response.text
    assert response.json()["profile"]["goal"] == "备考"

    chat = logged_client.post("/api/v1/chat", json={"question": "为什么联想记忆低？"})
    assert chat.status_code == 200, chat.text
    body = chat.json()
    assert body["reply"]["text"]
    assert body["reply"]["source"] in {"template", "llm"}
    assert isinstance(body["reply"]["citations"], list)
    assert len(body["messages"]) >= 2


def test_anonymous_api_call_is_rejected(client, needs_db):
    response = client.get("/api/v1/state")
    assert response.status_code == 401
    assert response.json()["detail"] == "unauthenticated"


def test_site_ai_settings_are_read_only(logged_client, needs_db):
    """BYOK is gone: the browser can read the model, never write a key."""
    saved = logged_client.put("/api/v1/settings/ai", json={"model": "hacker-model"})
    assert saved.status_code == 403
    assert saved.json()["detail"] == "ai_managed_by_site"
    assert logged_client.delete("/api/v1/settings/ai/key").status_code == 403
    payload = logged_client.get("/api/v1/settings/ai").json()
    assert payload["readOnly"] is True
    assert payload["managedBy"] == "site"
    assert "key" not in payload
