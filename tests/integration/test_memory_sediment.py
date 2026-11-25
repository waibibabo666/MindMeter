"""对话后记忆自动沉淀（用户点名的核心功能）。

人工实测：对话 6 条之后 `GET /api/v1/memory` 仍是 `profile={} summaries=0 advice=0`。
这组测试把"每轮有效对话都必须长出记忆"钉住，并钉住三条配套纪律：
  * 响应里的 `memory` 与 `GET /memory` 同形状（前端因此不必再 PUT 全量快照覆盖）；
  * 重复对话不产生重复建议；
  * 敏感轮次（危机/越界/疏导）与澄清轮次一律不落记忆。
"""
from __future__ import annotations

import uuid

import pytest

pytestmark = pytest.mark.usefixtures("needs_db")


def seed_assessment(client) -> str:
    assessment_id = f"s_mem_{uuid.uuid4().hex[:8]}"
    session = {
        "id": assessment_id,
        "mode": "standard",
        "finishedAt": "2026-11-15T08:00:00Z",
        "dims": ["vc", "ps", "sv", "am"],
        "results": {
            "vc": {"metrics": {"total": 8, "correct": 6}, "answers": []},
            "ps": {
                "metrics": {
                    "encCorrect": 12,
                    "encWrong": 2,
                    "catCorrect": 9,
                    "catWrong": 3,
                    "seconds": 45,
                },
                "answers": [],
            },
            "sv": {"metrics": {"total": 8, "correct": 5}, "answers": []},
            "am": {
                "metrics": {"targets": 8, "firstTry": 3, "hits": 4, "falseAlarms": 3},
                "answers": [{"isOld": True}] * 8 + [{"isOld": False}] * 8,
            },
        },
    }
    response = client.post("/api/v1/assessments", json={"session": session})
    assert response.status_code == 200, response.text
    return assessment_id


def chat(client, question: str) -> dict:
    response = client.post("/api/v1/chat", json={"question": question})
    assert response.status_code == 200, response.text
    return response.json()


def memory(client) -> dict:
    return client.get("/api/v1/memory").json()


def _first_scores(client) -> dict:
    sessions = client.get("/api/v1/assessments").json()["sessions"]
    return {dim: score for dim, score in sessions[0]["scores"].items() if isinstance(score, int)}


def _first_scores(client) -> dict:
    """最近一次测评的参考分（只留整数，null 维度不参与"最低项"判断）。"""
    sessions = client.get("/api/v1/assessments").json()["sessions"]
    return {dim: score for dim, score in sessions[0]["scores"].items() if isinstance(score, int)}


# ---------------------------------------------------------------------------
# 摘要
# ---------------------------------------------------------------------------

def test_effective_turn_writes_a_summary(fresh_client):
    seed_assessment(fresh_client)
    body = chat(fresh_client, "为什么联想记忆低？")

    assert body["memoryUpdated"] is True
    summaries = memory(fresh_client)["summaries"]
    assert summaries, body
    text = summaries[-1]["text"]
    assert "对话摘要" in text
    assert "联想记忆" in text  # 主题来自问题点名的维度
    assert "None" not in text and "null" not in text.lower()
    assert summaries[-1]["tier"] == "standard"


def test_summary_reports_the_lowest_dimension_from_facts(fresh_client):
    seed_assessment(fresh_client)
    chat(fresh_client, "知觉速度怎么算的")
    summary = memory(fresh_client)["summaries"][-1]
    scores = _first_scores(fresh_client)
    lowest = min(scores, key=lambda dim: scores[dim])
    assert summary["lowest"]["id"] == lowest
    assert summary["lowest"]["value"] == scores[lowest]
    assert str(scores[lowest]) in summary["text"]


def test_summary_numbers_come_from_facts_only(fresh_client):
    """摘要里出现的数字，只能是本次参考分或我们自己数的建议条数——不许编。"""
    import re

    seed_assessment(fresh_client)
    chat(fresh_client, "我的认知怎么样")
    summary = memory(fresh_client)["summaries"][-1]
    numbers = {int(part) for part in re.findall(r"\d+", summary["text"])}
    allowed = set(_first_scores(fresh_client).values()) | {len(summary["adviceIds"])}
    assert numbers <= allowed, (numbers, allowed, summary["text"])


def test_clarify_and_unrelated_turns_do_not_write_memory(fresh_client):
    seed_assessment(fresh_client)
    before = memory(fresh_client)

    for question in ("嗯", "帮我写篇作文"):
        body = chat(fresh_client, question)
        assert body["memoryUpdated"] is False, question

    after = memory(fresh_client)
    assert after["summaries"] == before["summaries"]
    assert after["advice"] == before["advice"]


def test_pii_turn_does_not_write_memory(fresh_client):
    seed_assessment(fresh_client)
    body = chat(fresh_client, "我的手机号是13800138000，联想记忆为什么低")
    assert body["reply"]["code"] == "pii_blocked"
    assert body["memoryUpdated"] is False
    assert memory(fresh_client)["summaries"] == []


def test_sensitive_fixed_turns_stay_out_of_memory(fresh_client):
    """危机/越界/疏导轮次只在对话流里出现，不写进可导出的长期记忆（A7 隐私透明）。"""
    seed_assessment(fresh_client)
    for question in (
        "我不想活了",
        "我是不是有抑郁症",
        "最近压力很大睡不着",
        "我就是笨什么都记不住",
    ):
        body = chat(fresh_client, question)
        assert body["memoryUpdated"] is False, question
    snapshot = memory(fresh_client)
    assert snapshot["summaries"] == []
    assert snapshot["advice"] == []


def test_summary_is_upserted_per_assessment_and_day(fresh_client):
    seed_assessment(fresh_client)
    chat(fresh_client, "为什么联想记忆低？")
    first = memory(fresh_client)["summaries"]
    chat(fresh_client, "为什么联想记忆低？")
    second = memory(fresh_client)["summaries"]
    assert len(second) == len(first)  # 同一测评同一天的重复追问：更新那条，不叠加
    assert second[-1]["id"] == first[-1]["id"]


# ---------------------------------------------------------------------------
# 建议记录
# ---------------------------------------------------------------------------

def test_advice_given_in_conversation_is_recorded(fresh_client):
    seed_assessment(fresh_client)
    body = chat(fresh_client, "联想记忆怎么练")
    advice = memory(fresh_client)["advice"]
    assert advice, body["reply"]["text"]
    titles = [item["title"] for item in advice]
    assert any("联想记忆" in title or "场景" in title for title in titles), titles
    assert "None" not in " ".join(titles)
    # 指标行不该被当成建议存下来
    assert not any(title.startswith("再认命中") for title in titles), titles


def test_repeated_conversation_does_not_duplicate_advice(fresh_client):
    seed_assessment(fresh_client)
    for _ in range(3):
        chat(fresh_client, "联想记忆怎么练")
    advice = memory(fresh_client)["advice"]
    ids = [item["id"] for item in advice]
    assert len(ids) == len(set(ids))
    assert len(advice) <= 3, advice  # 三轮同样的追问不该把建议表刷满


def test_same_advice_worded_differently_still_collapses(fresh_client):
    """兜底模板一处写"知觉速度 · 需要快速判断时…"、一处只写"需要快速判断时…"，仍是一条。"""
    seed_assessment(fresh_client)
    chat(fresh_client, "我明天建议测什么")
    first = len(memory(fresh_client)["advice"])
    chat(fresh_client, "知觉速度怎么练")
    second = memory(fresh_client)["advice"]
    assert len(second) == first, [item["title"] for item in second]
    titles = [item["title"] for item in second]
    ps_rows = [title for title in titles if "快速判断" in title]
    assert len(ps_rows) == 1, titles
    # 记忆面板上的长期文案不该被截在半句上
    assert not any(title.endswith(("长时", "一次长", "，最")) for title in titles), titles


def test_done_flag_survives_repeated_advice(fresh_client):
    seed_assessment(fresh_client)
    chat(fresh_client, "联想记忆怎么练")
    advice_id = memory(fresh_client)["advice"][0]["id"]
    fresh_client.patch(f"/api/v1/memory/advice/{advice_id}", json={"done": True})
    chat(fresh_client, "联想记忆怎么练")
    refreshed = memory(fresh_client)["advice"]
    marked = [item for item in refreshed if item["id"] == advice_id]
    assert len(marked) == 1
    assert marked[0]["done"] is True  # 用户勾掉的完成状态不能被 Agent 覆写


# ---------------------------------------------------------------------------
# 画像：只认明确表达，且必须已确认才写
# ---------------------------------------------------------------------------

def test_profile_is_not_written_without_confirmation(fresh_client):
    seed_assessment(fresh_client)
    body = chat(fresh_client, "你好，我想提高联想记忆")
    profile = memory(fresh_client)["profile"]
    assert profile.get("confirmed") is not True
    assert not (profile.get("goal") or "").strip()  # 一个字段都没写
    assert body["profileSuggested"], body  # 但要把线索交给前端做确认


def test_confirmed_profile_updates_on_explicit_goal(fresh_client):
    seed_assessment(fresh_client)
    fresh_client.put(
        "/api/v1/memory/profile",
        json={"goal": "备考", "preference": "", "constraint": "", "confirmed": True},
    )
    body = chat(fresh_client, "我的目标是通过体测，联想记忆怎么练")
    assert body["profileSuggested"] is None  # 已经写进画像，不再提示
    profile = memory(fresh_client)["profile"]
    assert "体测" in profile["goal"]
    assert profile["confirmed"] is True


def test_polite_question_is_not_mistaken_for_a_goal(fresh_client):
    seed_assessment(fresh_client)
    body = chat(fresh_client, "我想问下知觉速度是什么")
    assert body.get("profileSuggested") is None


# ---------------------------------------------------------------------------
# 响应契约与上限
# ---------------------------------------------------------------------------

def test_chat_response_memory_matches_get_memory(fresh_client):
    seed_assessment(fresh_client)
    body = chat(fresh_client, "这两次测评有什么变化")
    snapshot = memory(fresh_client)
    assert set(body["memory"]) == set(snapshot)
    assert body["memory"]["summaries"] == snapshot["summaries"]
    assert body["memory"]["advice"] == snapshot["advice"]
    assert body["messages"] == snapshot["messages"]


def test_chat_never_wipes_server_written_memory(fresh_client):
    """旧前端 writeMemory() 的 PUT 是整份替换；服务端沉淀不能被这一步抹掉。

    这里验证的是后端侧的可恢复性：/chat 一定把最新整份记忆带回，前端只要采用
    返回值就不会覆盖。顺带确认 PUT 空快照后再对话，摘要会重新长出来。
    """
    seed_assessment(fresh_client)
    chat(fresh_client, "联想记忆怎么练")
    assert memory(fresh_client)["summaries"]

    fresh_client.put(
        "/api/v1/memory",
        json={"profile": {}, "summaries": [], "advice": [], "messages": []},
    )
    assert memory(fresh_client)["summaries"] == []

    body = chat(fresh_client, "联想记忆怎么练")
    assert body["memoryUpdated"] is True
    assert memory(fresh_client)["summaries"]


def test_memory_tables_are_capped(fresh_client):
    seed_assessment(fresh_client)
    snapshot = {
        "profile": {},
        "summaries": [
            {
                "id": f"sum_old_{index}",
                "at": 1700000000000 + index,
                "tier": "standard",
                "text": f"历史摘要 {index}",
            }
            for index in range(25)
        ],
        "advice": [
            {"id": f"adv_old_{index}", "at": 1700000000000 + index, "title": f"历史建议 {index}"}
            for index in range(35)
        ],
        "messages": [],
    }
    fresh_client.put("/api/v1/memory", json=snapshot)

    chat(fresh_client, "知觉速度是什么")
    result = memory(fresh_client)
    assert len(result["summaries"]) <= 20, len(result["summaries"])
    assert len(result["advice"]) <= 30, len(result["advice"])
    assert any(item["id"].startswith("sum_chat_") for item in result["summaries"])


def test_sedimentation_is_per_account(fresh_client, app_instance):
    """两个账号各自沉淀；共用同一个 advice id 也不会互相覆写。

    advice id 允许跨账号相同（内容哈希 / kb 编号），主键是 (user_id, id) ——
    真正要保证的是"我勾的完成状态不会跑到你那里"，与 tenancy 套件同一口径。
    """
    from conftest import register_account

    mine_assessment = seed_assessment(fresh_client)
    chat(fresh_client, "联想记忆怎么练")

    other, _name, _pwd = register_account(app_instance)
    assert memory(other)["summaries"] == []
    assert memory(other)["advice"] == []

    # 没有测评结果的账号：不该凭空长出带数字的摘要
    chat(other, "联想记忆怎么练")
    other_summaries = memory(other)["summaries"]
    if other_summaries:
        assert "参考分" not in other_summaries[-1]["text"], other_summaries[-1]["text"]

    fresh_client.patch("/api/v1/memory/advice/kb-dim-am-01", json={"done": True})
    mine = [item for item in memory(fresh_client)["advice"] if item["id"] == "kb-dim-am-01"]
    theirs = [item for item in memory(other)["advice"] if item["id"] == "kb-dim-am-01"]
    assert mine, memory(fresh_client)["advice"]
    if theirs:
        assert mine[0]["done"] is True
        assert theirs[0]["done"] is False

    summary = memory(fresh_client)["summaries"][0]
    assert mine_assessment in summary["id"]  # 摘要 id 按测评隔离，跨账号不撞


def test_clear_all_memory_also_clears_conversations(logged_client):
    """第 3 轮实测的语义缺口：「清除全部记忆」以前不删对话。

    界面写的是"删除后 AI 不会再引用"（A7 隐私透明），实现却把 ChatMessage
    全留下 —— 承诺与实现不一致。
    """
    seed_assessment(logged_client)
    chat(logged_client, "联想记忆怎么练")
    before = memory(logged_client)
    assert before["messages"] and before["summaries"]

    cleared = logged_client.delete("/api/v1/memory")
    assert cleared.status_code == 200, cleared.text

    after = memory(logged_client)
    assert after["messages"] == []
    assert after["summaries"] == []
    assert after["advice"] == []
    assert not (after["profile"] or {}).get("confirmed")


def test_clear_messages_keeps_summaries_and_advice(logged_client):
    """对话页的「清空对话」必须是窄语义：只清对话。"""
    seed_assessment(logged_client)
    chat(logged_client, "联想记忆怎么练")
    before = memory(logged_client)
    assert before["messages"] and before["summaries"]

    result = logged_client.delete("/api/v1/memory/messages")
    assert result.status_code == 200, result.text
    assert result.json()["removed"] >= 1

    after = memory(logged_client)
    assert after["messages"] == []
    assert after["summaries"] == before["summaries"], "清空对话不该动摘要"
    assert after["advice"] == before["advice"], "清空对话不该动建议记录"


def test_single_message_delete_does_not_clobber_sedimented_rows(logged_client):
    """记忆面板的逐条删除必须是定向的。

    以前"删一条对话"只能用 `PUT /memory` 全量快照实现，那会先 DELETE 本账号的
    summaries/advice 再按客户端缓存重写 —— 于是"删一条聊天记录"顺手抹掉了
    服务端刚沉淀的摘要与建议（用户表现为"记忆又空了"）。
    """
    seed_assessment(logged_client)
    chat(logged_client, "联想记忆怎么练")
    before = memory(logged_client)
    assert before["summaries"], "前置条件：本轮对话已经沉淀出摘要"
    assert before["messages"], "前置条件：有对话记录"

    message_id = before["messages"][-1]["id"]
    removed = logged_client.delete(f"/api/v1/memory/messages/{message_id}")
    assert removed.status_code == 200, removed.text

    after = memory(logged_client)
    assert message_id not in [item["id"] for item in after["messages"]]
    # 关键断言：摘要与建议一条都没丢
    assert len(after["summaries"]) == len(before["summaries"]), after["summaries"]
    assert len(after["advice"]) == len(before["advice"]), after["advice"]

    missing = logged_client.delete("/api/v1/memory/messages/nope_123")
    assert missing.status_code == 404
    assert missing.json()["detail"] == "message_not_found"


def test_advice_done_survives_next_turn(logged_client):
    """用户勾过的"已完成"不能被下一轮对话沉淀覆写。"""
    seed_assessment(logged_client)
    chat(logged_client, "联想记忆怎么练")
    advice = memory(logged_client)["advice"]
    assert advice, advice
    target = advice[0]["id"]
    logged_client.patch(f"/api/v1/memory/advice/{target}", json={"done": True})

    chat(logged_client, "联想记忆怎么练")
    after = [item for item in memory(logged_client)["advice"] if item["id"] == target]
    assert after and after[0]["done"] is True, after
