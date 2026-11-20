"""真实模型的两段建议格式必须能沉淀成建议记录（用户点名的核心功能）。

2026-11-20 复跑（真实 glm-4-flash-250414，3 轮 × 3 问）实测：
`GET /api/v1/memory` 是 `summaries=1 advice=0 messages=18` —— 对话里明明写了
`练习建议：1. 专注建立联系：…` 与 `1. 睡眠与休息：保证充足睡眠…`，
旧抽取器只认"建议小节 + `·` 条目 + kb-plan 引用"这三种形状，一条都没抓到。

这里钉住四件事：
  * 两种真实格式各抽出 2 条，title 保留「标题：正文」的完整可执行内容；
  * 重复对话不产生重复行（id 稳定）；
  * 用户勾过的 `done` 不被覆写；
  * 免责句（"这些数字不能说明能力高低"）不会被当成建议。
"""
from __future__ import annotations

import uuid

import pytest

pytestmark = pytest.mark.usefixtures("needs_db")

# ---- 真实模型输出，逐字摘录（第一段有"练习建议："小节，第二段连标题都没有） ----
MODEL_REPLY_A = (
    "联想记忆这次首次配对成功 3/8 组，再认命中 4 个、虚报 3 个，平均每次作答约 1.87 秒。\n"
    "\n"
    "练习建议：\n"
    "1. 专注建立联系：练习时尝试将新信息与已知事物建立具体、独特的联系，而非简单记忆。\n"
    "2. 限时训练：使用计时器模拟测试环境，把每次练习控制在 5 分钟内。\n"
    "\n"
    "这些数字只反映本次任务，不是常模，也不与人群比较。\n"
    "引用：kb-dim-am-01 · 联想记忆测什么"
)
MODEL_REPLY_B = (
    "空间视觉化本次 8 题答对 6 题。\n"
    "\n"
    "1. 睡眠与休息：保证充足睡眠，尤其是前一晚。空间视觉化任务依赖心理旋转，充足睡眠有助于维持图像操作能力。\n"
    "2. 环境与注意力：在安静环境中练习空间视觉化任务，减少干扰。\n"
    "\n"
    "这些数字不能说明能力高低。"
)
# 免责句被写成编号条目时也不能进建议表。
MODEL_REPLY_DISCLAIMER = (
    "练习建议：\n"
    "1. 睡眠与休息：保证充足睡眠，尤其是前一晚。\n"
    "2. 这些数字不能说明能力高低，也不与人群比较。\n"
    "3. 记录与复测：隔天用同一档位再测一次，把每次的用时记下来。"
)


def seed_assessment(client) -> str:
    assessment_id = f"s_advice_{uuid.uuid4().hex[:8]}"
    session = {
        "id": assessment_id,
        "mode": "standard",
        "finishedAt": "2026-11-15T08:00:00Z",
        "dims": ["vc", "ps", "sv", "am"],
        "results": {
            "vc": {"metrics": {"total": 8, "correct": 5}, "answers": []},
            "ps": {
                "metrics": {"encCorrect": 12, "encWrong": 2, "catCorrect": 9, "catWrong": 3, "seconds": 45},
                "answers": [],
            },
            "sv": {"metrics": {"total": 8, "correct": 6}, "answers": []},
            "am": {
                "metrics": {"targets": 8, "firstTry": 3, "hits": 4, "falseAlarms": 3},
                "answers": [{"isOld": True}] * 8 + [{"isOld": False}] * 8,
            },
        },
    }
    response = client.post("/api/v1/assessments", json={"session": session})
    assert response.status_code == 200, response.text
    return assessment_id


def use_model_output(monkeypatch, text: str, citations=None) -> None:
    """让 `/chat` 走"模型已经答完"的分支：沉淀路径与真实模型输出同形状。

    测试环境没有 Key，只能把这一轮的模型回答固定下来 —— 抽取器与写库都是同一份代码，
    真实模型的原文形状见模块开头的两段摘录。
    """
    sources = [
        {"id": item, "title": "联想记忆测什么", "text": "词对配对与再认。", "source": {}}
        for item in (citations or ["kb-dim-am-01"])
    ]

    def _answer(db, question, facts, history, memory, scene="chat_explain", chunks=None):
        return {
            "intent": "explain",
            "risk": "low",
            "text": text,
            "citations": [item["id"] for item in sources],
            "sources": sources,
            "source": "llm",
            "code": "ok",
            "model": "glm-4-flash-250414",
            "latency_ms": 900,
            "validation": [],
        }

    monkeypatch.setattr("app.api.chat.answer", _answer)


def memory(client) -> dict:
    return client.get("/api/v1/memory").json()


# ---------------------------------------------------------------------------
# 纯函数：两段真实格式
# ---------------------------------------------------------------------------

def test_real_model_practice_section_extracts_two_items():
    from app.agent.insights import advice_from_reply

    items = advice_from_reply(MODEL_REPLY_A, [])
    assert len(items) == 2, items
    titles = [item["title"] for item in items]
    assert titles[0] == "专注建立联系：练习时尝试将新信息与已知事物建立具体、独特的联系，而非简单记忆"
    assert titles[1].startswith("限时训练：使用计时器模拟测试环境")
    # 面板要能看懂这条建议是什么：标题 + 可执行正文都留着
    assert all("：" in title for title in titles), titles
    assert all(len(title) <= 56 for title in titles), titles
    assert all(item["id"] and item["key"] for item in items)


def test_real_model_bare_numbered_list_extracts_two_items():
    """第二段连"练习建议："都没有，旧实现因此 advice=0。"""
    from app.agent.insights import advice_from_reply

    items = advice_from_reply(MODEL_REPLY_B, [])
    assert len(items) == 2, items
    titles = [item["title"] for item in items]
    assert titles[0] == "睡眠与休息：保证充足睡眠，尤其是前一晚"
    assert titles[1] == "环境与注意力：在安静环境中练习空间视觉化任务，减少干扰"


def test_disclaimer_item_is_not_advice():
    from app.agent.insights import advice_from_reply

    items = advice_from_reply(MODEL_REPLY_DISCLAIMER, [])
    titles = [item["title"] for item in items]
    assert not any("不能说明" in title for title in titles), titles
    assert len(items) == 2, titles


def test_metric_dump_is_not_advice():
    """指标清单（模板形状）不能因为"编号也算"被误抽成建议。"""
    from app.agent.insights import advice_from_reply

    text = (
        "这次相关维度的原始数字是：\n"
        "1. 言语理解：共 8 题答对 5 题，平均每次作答 2.5 秒\n"
        "2. 联想记忆：再认命中 4 个、虚报 3 个，平均每次作答 1.87 秒\n"
        "3. 首次配对成功 3/8 组"
    )
    assert advice_from_reply(text, []) == []


def test_ids_are_stable_across_replies():
    from app.agent.insights import advice_from_reply

    first = advice_from_reply(MODEL_REPLY_B, [])
    second = advice_from_reply("前言不同\n" + MODEL_REPLY_B.split("\n", 1)[1], [])
    assert [item["id"] for item in first] == [item["id"] for item in second], (first, second)


def test_cited_plan_chunk_still_produces_advice_without_list():
    from app.agent.insights import advice_from_reply

    items = advice_from_reply("这次没有可解读的建议。", [{"id": "kb-plan-01", "title": "日常可以怎么做"}])
    assert [item["id"] for item in items] == ["kb-plan-01"], items


def test_fallback_uses_cited_dimension_chunk():
    """回答里一条编号建议都没有时（真实模型偶尔这样），从本轮真的引用过的知识块反推。"""
    from app.agent.insights import advice_from_reply

    items = advice_from_reply(
        "联想记忆这次命中 4 个、虚报 3 个。这些数字只反映本次任务。\n引用：kb-dim-am-01 · 联想记忆测什么",
        [{"id": "kb-dim-am-01", "title": "联想记忆测什么", "text": "词对配对与再认。", "source": {}}],
    )
    assert len(items) == 1, items
    assert items[0]["id"] == "kb-dim-am-01"
    assert "场景" in items[0]["title"], items[0]


# ---------------------------------------------------------------------------
# 库侧：核心功能必须真的长出东西
# ---------------------------------------------------------------------------

def test_real_model_advice_reaches_memory_panel(fresh_client, monkeypatch):
    seed_assessment(fresh_client)
    use_model_output(monkeypatch, MODEL_REPLY_A)
    body = fresh_client.post("/api/v1/chat", json={"question": "为什么联想记忆低？"}).json()
    assert body["memoryUpdated"] is True
    advice = memory(fresh_client)["advice"]
    assert len(advice) == 2, advice
    assert "练习" in advice[0]["title"]
    assert body["reply"]["text"]


def test_real_model_bare_numbered_advice_reaches_memory_panel(fresh_client, monkeypatch):
    seed_assessment(fresh_client)
    use_model_output(monkeypatch, MODEL_REPLY_B, citations=[])
    fresh_client.post("/api/v1/chat", json={"question": "空间视觉化怎么练"})
    advice = memory(fresh_client)["advice"]
    assert {item["title"] for item in advice} == {
        "睡眠与休息：保证充足睡眠，尤其是前一晚",
        "环境与注意力：在安静环境中练习空间视觉化任务，减少干扰",
    }, advice


def test_repeated_real_model_turns_do_not_duplicate_advice(fresh_client, monkeypatch):
    seed_assessment(fresh_client)
    use_model_output(monkeypatch, MODEL_REPLY_A)
    for _ in range(3):
        fresh_client.post("/api/v1/chat", json={"question": "为什么联想记忆低？"})
    advice = memory(fresh_client)["advice"]
    assert len(advice) == 2, advice
    assert len({item["id"] for item in advice}) == 2


def test_done_flag_survives_real_model_replay(fresh_client, monkeypatch):
    seed_assessment(fresh_client)
    use_model_output(monkeypatch, MODEL_REPLY_A)
    fresh_client.post("/api/v1/chat", json={"question": "为什么联想记忆低？"})
    target = memory(fresh_client)["advice"][0]["id"]
    fresh_client.patch(f"/api/v1/memory/advice/{target}", json={"done": True})

    fresh_client.post("/api/v1/chat", json={"question": "为什么联想记忆低？"})
    after = [item for item in memory(fresh_client)["advice"] if item["id"] == target]
    assert len(after) == 1, after
    assert after[0]["done"] is True, after
    assert after[0]["title"], after


def test_advice_cap_still_holds_with_real_model_formats(fresh_client, monkeypatch):
    seed_assessment(fresh_client)
    snapshot = {
        "profile": {},
        "summaries": [],
        "advice": [
            {"id": f"adv_old_{index}", "at": 1700000000000 + index, "title": f"历史建议 {index}"}
            for index in range(35)
        ],
        "messages": [],
    }
    fresh_client.put("/api/v1/memory", json=snapshot)
    use_model_output(monkeypatch, MODEL_REPLY_A)
    for _ in range(3):
        fresh_client.post("/api/v1/chat", json={"question": "为什么联想记忆低？"})
    assert len(memory(fresh_client)["advice"]) <= 30
