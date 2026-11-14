"""趋势联动与统一出口的 API 级回归（需可丢弃数据库，CI 里跑）。"""
from __future__ import annotations

import uuid

import pytest

pytestmark = pytest.mark.usefixtures("needs_db")


def _session_payload(assessment_id, finished_at, vc_correct):
    return {
        "id": assessment_id,
        "mode": "standard",
        "finishedAt": finished_at,
        "dims": ["vc", "ps", "sv", "am"],
        "results": {
            "vc": {"metrics": {"total": 6, "correct": vc_correct}, "answers": []},
            "ps": {"metrics": {"seconds": 60, "trials": 10, "correct": 8, "wrong": 2}, "answers": []},
            "sv": {"metrics": {"total": 8, "correct": 6}, "answers": []},
            "am": {"metrics": {"hits": vc_correct, "falseAlarms": 2}, "answers": []},
        },
    }


def test_trends_endpoint_carries_delta_and_repeat_risk(client):
    tag = uuid.uuid4().hex[:6]
    prev = client.post(
        "/api/v1/assessments",
        json={"session": _session_payload(f"s_prev_{tag}", "2027-01-01T01:00:00Z", 6)},
    )
    nxt = client.post(
        "/api/v1/assessments",
        json={"session": _session_payload(f"s_next_{tag}", "2027-01-10T01:00:00Z", 5)},
    )
    assert prev.status_code == nxt.status_code == 200

    trends = client.get("/api/v1/trends").json()
    assert trends["days"] == 9
    assert trends["repeatRisk"] is False
    assert trends["prevId"] == f"s_prev_{tag}"
    assert trends["nextId"] == f"s_next_{tag}"
    by_id = {row["id"]: row for row in trends["rows"]}
    assert by_id["vc"]["delta"] == by_id["vc"]["next"] - by_id["vc"]["prev"]
    assert by_id["vc"]["name"] == "言语理解"


def test_chat_trend_question_routes_trend_scene(client):
    response = client.post("/api/v1/chat", json={"question": "这两次测评有什么变化"})
    assert response.status_code == 200, response.text
    reply = response.json()["reply"]
    assert reply["intent"] == "trend"
    assert reply["text"]
    # CI 无模型 Key：必须走趋势模板兜底，且带共同维度变化行。
    assert reply["source"] == "template"
    assert "→" in reply["text"]


def test_chat_self_blame_never_calls_model(client):
    response = client.post("/api/v1/chat", json={"question": "我就是笨，什么都记不住"})
    assert response.status_code == 200, response.text
    reply = response.json()["reply"]
    assert reply["intent"] == "self_blame"
    assert "测评能得出的结论" in reply["text"]


def test_report_explain_goes_through_validation(client):
    tag = uuid.uuid4().hex[:6]
    created = client.post(
        "/api/v1/assessments",
        json={"session": _session_payload(f"s_rep_{tag}", "2027-02-01T01:00:00Z", 5)},
    )
    assert created.status_code == 200
    response = client.post(f"/api/v1/reports/s_rep_{tag}/explain")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["text"]
    assert body["source"] in {"template", "llm"}
    if body["source"] == "template":
        assert body["code"] in (None, "not_configured")
