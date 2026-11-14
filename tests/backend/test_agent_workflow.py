"""Agent P0 工作流测试：路由、场景策略、派生数字、统一出口、历史时序。

不依赖数据库：classify/validate/build_messages 为纯函数；图级测试用假
AISettings 与假 call_llm（CI 无需 Key）。对应设计文档 §九 1/3/4/5/7。
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest

from app import agent as A
from app.agent import (
    FIXED_REPLY,
    INTENT,
    build_messages,
    classify,
    derived_allowed_numbers,
    validate_text,
)
from app.agent.policies import policy_for, prompt_for
from app.llm import LLMReply

TREND_FACTS = {
    "am": {"score": 51, "hits": 5, "falseAlarms": 3},
    "trend": {
        "prevId": "s1",
        "nextId": "s2",
        "rows": [{"id": "am", "name": "联想记忆", "prev": 44, "next": 51, "delta": 7}],
        "onlyPrev": [],
        "onlyNext": [],
        "days": 9,
        "repeatRisk": False,
    },
}

KB_CHUNKS = [{"id": "kb-limit-01", "title": "练习效应", "text": "复测间隔过近会抬高成绩。"}]
GOOD_TREND_REPLY = (
    "联想记忆 44 → 51，差值 +7，间隔 9 天。"
    "这只描述两次分数的差值，不等于训练效果，也不与人群比较。引用：kb-limit-01 · 练习效应"
)


def run_graph(monkeypatch, question, facts, reply_text, chunks=KB_CHUNKS, scene="chat_explain"):
    settings = SimpleNamespace(endpoint="https://fake/v1", model="test-model", enabled=True)

    class FakeDb:
        def scalar(self, _stmt):
            return settings

    calls = {"llm": 0, "retrieve": 0, "messages": None}

    def fake_retrieve(db, query, limit=3):
        calls["retrieve"] += 1
        return list(chunks)

    def fake_call_llm(**kwargs):
        calls["llm"] += 1
        calls["messages"] = kwargs["messages"]
        return LLMReply(text=reply_text, model="test-model")

    monkeypatch.setattr(A, "retrieve_kb", fake_retrieve)
    monkeypatch.setattr(A, "call_llm", fake_call_llm)
    monkeypatch.setattr("app.keyring_store.get_llm_key", lambda: "sk-test")
    result = A.answer(FakeDb(), question, facts, [], None, scene=scene)
    return result, calls


# ---------- classify：趋势 / 自责 / 安全优先 ----------

@pytest.mark.parametrize("question", [
    "这两次测评有什么变化",
    "帮我对比一下两次分数",
    "上次和这次的分数",
    "复测之后知觉速度差多少",
])
def test_classify_routes_trend(question):
    assert classify(question)["intent"] == INTENT["TREND"]


def test_classify_advice_followup_stays_explain():
    # 设计文档 §6.2：弱词「上次」+ 建议类语境不是趋势解释。
    assert classify("上次那个建议怎么还没做")["intent"] == INTENT["EXPLAIN"]


def test_classify_self_blame_and_non_trigger():
    assert classify("我就是笨，什么都记不住")["intent"] == INTENT["SELF_BLAME"]
    assert classify("我脑子不行")["intent"] == INTENT["SELF_BLAME"]
    assert classify("这个方法没用")["intent"] != INTENT["SELF_BLAME"]
    assert "测评能得出的结论" in FIXED_REPLY[INTENT["SELF_BLAME"]]


def test_classify_safety_words_always_first():
    assert classify("我真没用，不想活了")["intent"] == INTENT["CRISIS"]
    assert classify("这变化是不是抑郁症的表现")["intent"] == INTENT["BOUNDARY"]
    assert classify("天气变化大吗")["intent"] == INTENT["UNRELATED"]


def test_classify_legacy_intents_unchanged():
    assert classify("联想记忆为什么低")["intent"] == INTENT["EXPLAIN"]
    assert classify("我是不是有抑郁症")["intent"] == INTENT["BOUNDARY"]
    assert classify("帮我写作文")["intent"] == INTENT["UNRELATED"]
    assert classify("")["intent"] == INTENT["CLARIFY"]


# ---------- validate：派生数字 / 场景策略 / 软校验 ----------

def test_derived_numbers_allowed_but_invented_fail():
    allowed = derived_allowed_numbers({"am": {"hits": 5, "falseAlarms": 3}})
    assert 8.0 in allowed and 2.0 in allowed and 62.0 in allowed
    good = validate_text(
        "命中 5、虚报 3，正确率 62%。仅供参考。引用：kb-dim-am-01 · 联想记忆",
        allowed_numbers=allowed,
        policy=policy_for("chat_explain"),
    )
    assert good["ok"]
    bad = validate_text(
        "你的正确率是 91%。仅供参考。引用：kb-dim-am-01 · 联想记忆",
        allowed_numbers=allowed,
        policy=policy_for("chat_explain"),
    )
    assert not bad["ok"]
    assert any(issue["code"] == "unsourced_number" and issue["severity"] == "hard" for issue in bad["issues"])


def test_trend_scene_bans_progress_words_others_dont():
    policy_trend = policy_for("trend")
    policy_explain = policy_for("chat_explain")
    text = "整体在进步。仅供参考。引用：kb-limit-01 · 练习效应"
    assert not validate_text(text, allowed_numbers=[], policy=policy_trend)["ok"]
    assert validate_text(text, allowed_numbers=[], policy=policy_explain)["ok"]


def test_new_clinical_words_are_banned():
    result = validate_text(
        "这属于认知减退信号。引用：kb-x · t",
        allowed_numbers=[],
        policy=policy_for("chat_explain"),
    )
    assert not result["ok"]
    assert any(issue["code"] == "banned_word" for issue in result["issues"])


def test_soft_issues_keep_llm_answer():
    # 缺引用、缺边界声明都是 soft：不判死，但留下记录。
    result = validate_text(
        "联想记忆命中 5、虚报 3。", allowed_numbers=[5.0, 3.0], policy=policy_for("chat_explain")
    )
    assert result["ok"]
    codes = {issue["code"] for issue in result["issues"]}
    assert {"citation_missing", "scope_note_missing"} <= codes
    assert all(issue["severity"] == "soft" for issue in result["issues"])


def test_scene_lengths_are_policy_driven():
    long_201 = "字" * 201
    assert not validate_text(long_201, policy=policy_for("chat_explain"))["ok"]
    assert validate_text(long_201, policy=policy_for("trend"))["ok"]
    long_301 = "字" * 301
    assert not validate_text(long_301, policy=policy_for("trend"))["ok"]


# ---------- build_messages：时序与场景块 ----------

def test_history_precedes_current_question():
    history = [
        {"role": "user", "content": "旧问题"},
        {"role": "assistant", "content": "旧回答"},
    ]
    messages = build_messages("新问题", {}, [], history, None)
    assert messages[0]["role"] == "system"
    assert messages[1]["content"] == "旧问题"
    assert messages[2]["content"] == "旧回答"
    assert "用户问题：新问题" in messages[-1]["content"]


def test_trend_block_rendered_and_facts_excludes_it():
    messages = build_messages("这两次有什么变化", TREND_FACTS, KB_CHUNKS, [], None, scene="trend")
    user = messages[-1]["content"]
    assert "两次对比数据" in user
    assert "联想记忆 44 → 51（+7）" in user
    assert "间隔 9 天" in user


def test_scene_prompts_share_discipline():
    trend = prompt_for("trend")
    report = prompt_for("report")
    assert "换算为 MoCA" in trend and "换算为 MoCA" in report
    assert "进步" in trend  # 趋势场景额外纪律
    assert policy_for("report")["require_citation"] == "off"


# ---------- 图级：趋势链路 / 统一出口 / miss 分级 ----------

def test_trend_good_answer_keeps_llm_and_strips_citation_line(monkeypatch):
    result, calls = run_graph(monkeypatch, "这两次测评有什么变化", TREND_FACTS, GOOD_TREND_REPLY)
    assert result["intent"] == "trend"
    assert result["source"] == "llm"
    assert "引用：" not in result["text"]  # 展示走 citations 数组
    assert result["citations"] == ["kb-limit-01"]
    assert calls["llm"] == 1 and calls["retrieve"] == 1


def test_trend_judgment_word_falls_back_to_trend_template(monkeypatch):
    result, _ = run_graph(monkeypatch, "这两次测评有什么变化", TREND_FACTS, "总体看你有进步。")
    assert result["source"] == "template"
    assert result["code"] == "invalid"
    assert "44 → 51" in result["text"]
    assert "进步" not in result["text"]


def test_trend_without_two_assessments_is_short_circuited(monkeypatch):
    facts = {"am": {"score": 51, "hits": 5, "falseAlarms": 3}}  # 没有 trend 键
    result, calls = run_graph(monkeypatch, "这两次有什么变化", facts, "不该被调用")
    assert result["code"] == "trend_no_data"
    assert result["text"] == FIXED_REPLY[INTENT["TREND_NO_DATA"]]
    assert calls["llm"] == 0 and calls["retrieve"] == 0


def test_report_scene_skips_retrieve_but_stays_validated(monkeypatch):
    facts = {"vc": {"correct": 5, "total": 6}}
    result, calls = run_graph(
        monkeypatch, "解释一下", facts, "建议就医评估。", scene="report"
    )
    assert calls["retrieve"] == 0  # 报告场景不检索
    assert calls["llm"] == 1  # 但一定调校验：违规输出被拦
    assert result["source"] == "template"
    assert "就医" not in result["text"]
    assert "言语理解" in result["text"]  # template_narrative 兜底


def test_explain_without_knowledge_can_still_answer_from_facts(monkeypatch):
    facts = {"vc": {"correct": 5, "total": 6}}
    reply = "言语理解正确 5/6，正确率 83%。仅供参考。"
    result, calls = run_graph(
        monkeypatch, "言语理解怎么样", facts, reply, chunks=[], scene="chat_explain"
    )
    assert result["source"] == "llm"  # miss 不再一票否决
    assert calls["llm"] == 1


def test_no_knowledge_and_no_facts_still_says_not_known(monkeypatch):
    result, calls = run_graph(monkeypatch, "报告怎么看", {}, "不该被调用", chunks=[])
    assert result["code"] == "no_knowledge"
    assert "我不猜" in result["text"]
    assert calls["llm"] == 0
