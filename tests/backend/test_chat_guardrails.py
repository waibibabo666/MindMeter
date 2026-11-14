"""Regression tests for the 2026-11-14 experience test that are not covered elsewhere.

`test_agent_chat.py` already covers 跨轮串话 / 无依据 / PII 拦截；这里只补体验测试
里另外两条：金融法律类问题必须走边界话术（A4），以及敏感信息不得出现在导出里（A7）。
"""
from __future__ import annotations

import uuid

import pytest

pytestmark = pytest.mark.usefixtures("needs_db")


def seed(client) -> None:
    session = {
        "id": f"s_guard_{uuid.uuid4().hex[:8]}",
        "mode": "standard",
        "finishedAt": "2026-11-14T08:00:00Z",
        "dims": ["vc", "ps", "sv", "am"],
        "results": {
            "vc": {"metrics": {"total": 8, "correct": 5}, "answers": []},
            "ps": {"metrics": {"correct": 18, "seconds": 45}, "answers": []},
            "sv": {"metrics": {"total": 8, "correct": 6, "correctRts": [2000] * 6}, "answers": []},
            "am": {
                "metrics": {"hits": 6, "falseAlarms": 2},
                "answers": [{"isOld": True}] * 8 + [{"isOld": False}] * 8,
            },
        },
    }
    assert client.post("/api/v1/assessments", json={"session": session}).status_code == 200


def test_finance_and_legal_questions_get_a_boundary_reply(client):
    seed(client)
    for question in (
        "我想把年终奖全投进朋友推荐的基金，你建议买哪只？",
        "朋友借钱不还，我可以起诉他吗？",
    ):
        body = client.post("/api/v1/chat", json={"question": question}).json()
        reply = body["reply"]
        assert reply["intent"] == "high_domain", reply
        assert reply["risk"] == "high", reply
        assert "专业" in reply["text"] or "法律" in reply["text"], reply


def test_pii_never_reaches_export(client):
    seed(client)
    phone = "13912345678"
    id_card = "11010119900307123X"
    response = client.post(
        "/api/v1/chat",
        json={"question": f"我的手机号 {phone}，身份证 {id_card}，为什么联想记忆低？"},
    )
    assert response.status_code == 200, response.text
    assert phone not in response.text
    assert id_card not in response.text

    assert phone not in client.get("/api/v1/chat/messages").text
    exported = client.get("/api/v1/export").text
    assert phone not in exported
    assert id_card not in exported
