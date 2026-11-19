"""Tenancy: two accounts on one host must never see each other's rows.

This is the test that a single-user desktop build could not have. It pins the
composite `(user_id, id)` keys, the per-user 50-session cap, and the fact that
client-generated ids may repeat across accounts without colliding.
"""
from __future__ import annotations

import pytest

from conftest import register_account, unique_username

pytestmark = pytest.mark.usefixtures("needs_db")

SESSION = {
    "mode": "standard",
    "finishedAt": "2026-11-18T01:00:00Z",
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


@pytest.fixture()
def pair(app_instance):
    first, first_name, _ = register_account(app_instance, unique_username("a"))
    second, second_name, _ = register_account(app_instance, unique_username("b"))
    first.account_name, second.account_name = first_name, second_name
    yield first, second
    first.close()
    second.close()


def make_session(assessment_id: str) -> dict:
    payload = dict(SESSION)
    payload["id"] = assessment_id
    return payload


def test_identical_assessment_ids_do_not_collide(pair):
    a, b = pair
    shared_id = "s_shared_001"
    assert a.post("/api/v1/assessments", json={"session": make_session(shared_id)}).status_code == 200
    created = b.post("/api/v1/assessments", json={"session": make_session(shared_id)})
    assert created.status_code == 200, created.text
    assert created.json()["idempotent"] is False

    assert a.get("/api/v1/assessments").json()["sessions"][0]["scores"]["vc"] == 100
    assert len(b.get("/api/v1/assessments").json()["sessions"]) == 1


def test_replay_within_one_account_stays_idempotent(pair):
    a, _b = pair
    payload = make_session("s_replay")
    a.post("/api/v1/assessments", json={"session": payload})
    again = a.post("/api/v1/assessments", json={"session": payload})
    assert again.json()["idempotent"] is True
    assert len(a.get("/api/v1/assessments").json()["sessions"]) == 1


def test_one_account_cannot_read_another_assessment(pair):
    a, b = pair
    a.post("/api/v1/assessments", json={"session": make_session("s_private")})
    assert b.get("/api/v1/assessments/s_private").status_code == 404
    assert b.get("/api/v1/reports/s_private").status_code == 404
    assert b.post("/api/v1/reports/s_private/explain").status_code == 404


def test_state_and_draft_are_private(pair):
    a, b = pair
    a.put("/api/v1/state", json={"tier": "deep", "results": {"vc": {"metrics": {"correct": 5}}}})
    assert b.get("/api/v1/state").json()["tier"] is None
    b.put("/api/v1/state", json={"tier": "quick"})
    assert a.get("/api/v1/state").json()["tier"] == "deep"


def test_shared_advice_ids_do_not_overwrite_each_other(pair):
    a, b = pair
    body = {"id": "kb-plan-01", "title": "分散练习", "at": "2026-11-18T01:00:00Z"}
    assert a.post("/api/v1/memory/advice", json=body).status_code == 200
    assert b.post("/api/v1/memory/advice", json=body).status_code == 200
    b.patch("/api/v1/memory/advice/kb-plan-01", json={"done": True})
    assert a.get("/api/v1/memory").json()["advice"][0]["done"] is False
    assert b.get("/api/v1/memory").json()["advice"][0]["done"] is True


def test_clear_data_leaves_the_other_account_intact(pair):
    a, b = pair
    a.post("/api/v1/assessments", json={"session": make_session("s_keepalive")})
    b.post("/api/v1/assessments", json={"session": make_session("s_keepalive")})
    a.delete("/api/v1/data")
    assert a.get("/api/v1/assessments").json()["sessions"] == []
    assert a.get("/api/v1/state").json()["tier"] is None
    assert len(b.get("/api/v1/assessments").json()["sessions"]) == 1


def test_export_never_contains_another_account(pair):
    a, b = pair
    marker = "s_marker_only_b"
    b.post("/api/v1/assessments", json={"session": make_session(marker)})
    b.put("/api/v1/memory/profile", json={"goal": "只有 B 知道的备考目标", "confirmed": True})
    text = a.get("/api/v1/export").text
    assert marker not in text
    assert "只有 B 知道的备考目标" not in text
    assert b.get("/api/v1/export").json()["memory"]["profile"]["goal"] == "只有 B 知道的备考目标"


def test_chat_history_is_private(pair):
    a, b = pair
    a.post("/api/v1/chat", json={"question": "为什么联想记忆低？"})
    assert len(b.get("/api/v1/chat/messages").json()["messages"]) == 0
    assert len(a.get("/api/v1/chat/messages").json()["messages"]) == 2


def test_session_cap_is_per_account(pair):
    a, b = pair
    for index in range(53):
        a.post("/api/v1/assessments", json={"session": make_session(f"s_many_{index}")})
    assert len(a.get("/api/v1/assessments", params={"limit": 50}).json()["sessions"]) == 50
    b.post("/api/v1/assessments", json={"session": make_session("s_untouched")})
    assert len(b.get("/api/v1/assessments").json()["sessions"]) == 1
