"""LLM 兜底意图路由（第 3 轮反馈 3 的架构升级）。

要钉住的不是"模型能不能分类"，而是三条安全不变式：
1. 安全红线不可降级（危机/越界/高风险领域/疏导/自责由关键词决定）；
2. 关键词已确定时不采纳模型（否则把已经正确的答案交给额外一跳去赌）；
3. 任何失败都等于这个功能不存在（未配置、超时、返回不可解析 → 沿用关键词）。
"""
from __future__ import annotations

import pytest

from app import agent as A
from app.agent import INTENT, needs_llm_fallback, resolve_intent
from app.agent.classify import classify
from app.agent.intent_llm import CLASSIFY_MAX_TOKENS, build_messages, classify_with_llm, parse_intent


# ---------------------------------------------------------------------------
# resolve_intent：纯函数三条不变式
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "keyword_intent",
    [
        INTENT["CRISIS"],
        INTENT["BOUNDARY"],
        INTENT["HIGH_DOMAIN"],
        INTENT["SUPPORT"],
        INTENT["SELF_BLAME"],
    ],
)
def test_safety_intents_are_never_overridden_by_the_model(keyword_intent):
    """模型说这是普通解释，也不能把求助/越界句从安全分支上拉下来。"""
    for other in (INTENT["EXPLAIN"], INTENT["SUMMARY"], INTENT["UNRELATED"], INTENT["CLARIFY"]):
        intent, source = resolve_intent({"intent": keyword_intent}, other)
        assert intent == keyword_intent
        assert source == "rule"


@pytest.mark.parametrize("keyword_intent", [INTENT["EXPLAIN"], INTENT["TREND"], INTENT["SUMMARY"]])
def test_confident_business_intents_are_not_downgraded(keyword_intent):
    intent, source = resolve_intent({"intent": keyword_intent}, INTENT["CLARIFY"])
    assert intent == keyword_intent and source == "rule"


def test_ambiguous_intents_are_rescued():
    for ambiguous in (INTENT["CLARIFY"], INTENT["UNRELATED"], INTENT["GREETING"]):
        assert needs_llm_fallback({"intent": ambiguous})
        intent, source = resolve_intent({"intent": ambiguous}, INTENT["SUMMARY"], has_facts=True)
        assert intent == INTENT["SUMMARY"]
        assert source == "llm"


def test_confident_intents_do_not_need_the_llm_at_all():
    for confident in (INTENT["EXPLAIN"], INTENT["TREND"], INTENT["SUMMARY"], INTENT["CRISIS"]):
        assert not needs_llm_fallback({"intent": confident})


@pytest.mark.parametrize("bad", [None, "", "nonsense", "diagnosis", "crisis", "greeting", "42"])
def test_out_of_set_or_missing_model_answer_falls_back_to_rule(bad):
    """闭集外的值一律不采纳 —— 包括模型试图返回我们没定义的意图。"""
    intent, source = resolve_intent({"intent": INTENT["CLARIFY"]}, bad)
    assert intent == INTENT["CLARIFY"] and source == "rule"


def test_crisis_is_not_in_the_llm_allowed_set():
    """模型无权产出 crisis：危机必须靠关键词命中，不能靠模型"识别出情绪"。"""
    from app.agent.classify import LLM_ALLOWED_INTENTS

    assert INTENT["CRISIS"] not in LLM_ALLOWED_INTENTS
    assert INTENT["GREETING"] not in LLM_ALLOWED_INTENTS  # 兜底不能把话退回寒暄


# ---------------------------------------------------------------------------
# parse_intent / build_messages
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("summary", INTENT["SUMMARY"]),
        ("SUMMARY", INTENT["SUMMARY"]),
        (" explain ", INTENT["EXPLAIN"]),
        ("意图：trend", INTENT["TREND"]),
        ("self_blame", INTENT["SELF_BLAME"]),
        ("unrelated", INTENT["UNRELATED"]),
        ("", None),
        ("我不知道", None),
        ("diagnosis", None),
    ],
)
def test_parse_intent_is_a_closed_set(raw, expected):
    assert parse_intent(raw) == expected


def test_parse_intent_prefers_the_longer_label():
    """self_blame 里含 unrelated 吗？不含；但 explain/trend 这类前缀重叠必须稳定。"""
    assert parse_intent("self_blame") == INTENT["SELF_BLAME"]
    assert parse_intent("trend") == INTENT["TREND"]


def test_build_messages_carries_recent_context_only():
    history = [{"role": m, "content": f"第{i}句"} for i, m in enumerate(["user", "assistant"] * 6)]
    messages = build_messages("那第二个呢", history)
    assert messages[0]["role"] == "system"
    assert "那第二个呢" in messages[1]["content"]
    # 只带最近 4 条，且每条截断，分类请求必须便宜
    assert len(messages) == 2
    assert messages[1]["content"].count("句") <= 4
    assert CLASSIFY_MAX_TOKENS <= 24


# ---------------------------------------------------------------------------
# 图级：调用时机与失败回退
# ---------------------------------------------------------------------------


def _stub_llm(monkeypatch, value, calls):
    def fake(question, history=None):
        calls.append(question)
        return value

    monkeypatch.setattr(A, "classify_with_llm", fake)


def test_ambiguous_question_is_rescued_end_to_end(monkeypatch):
    calls: list[str] = []
    _stub_llm(monkeypatch, INTENT["TREND"], calls)
    facts = {
        "vc": {"correct": 5, "total": 8, "score": 50},
        "am": {"hits": 4, "falseAlarms": 3, "score": 26},
        # 兜底改判到 trend 的前提是系统里真的有两次可比记录
        "trend": {"days": 9, "rows": [{"id": "vc", "prev": 40, "next": 50, "delta": 10}]},
    }
    # 「我跟以前比呢」没有任何词表信号（无维度名、无"两次/上次"），关键词只能落到 clarify
    assert classify("我跟以前比呢")["intent"] == INTENT["CLARIFY"]
    result = A.answer(None, "我跟以前比呢", facts, [], None)
    assert result["intent"] == INTENT["TREND"]
    assert result["intentSource"] == "llm"
    assert calls == ["我跟以前比呢"]


@pytest.mark.parametrize("question", ["嗯", "那个呢", "随便吧", "你觉得呢"])
def test_the_rescue_only_fires_on_genuinely_ambiguous_wording(monkeypatch, question):
    """钉住"哪些说法确实需要兜底" —— 词表覆盖不到的表达，正是模型该接手的部分。"""
    calls: list[str] = []
    _stub_llm(monkeypatch, INTENT["SUPPORT"], calls)
    result = A.answer(None, question, {}, [], None)
    assert calls == [question], f"{question} 本该由关键词兜住，词表变了请同步这条测试"
    assert result["intent"] == INTENT["SUPPORT"]
    assert result["intentSource"] == "llm"


def test_confident_question_never_calls_the_model(monkeypatch):
    """延迟预算：分类排在回答之前，能不调就不调。"""
    calls: list[str] = []
    _stub_llm(monkeypatch, INTENT["CLARIFY"], calls)
    facts = {"am": {"hits": 4, "falseAlarms": 3, "score": 26}}
    result = A.answer(None, "为什么联想记忆低", facts, [], None)
    assert result["intent"] == INTENT["EXPLAIN"]
    assert result["intentSource"] == "rule"
    assert calls == [], "关键词已经命中，不该再发分类请求"


def test_safety_question_never_calls_the_model(monkeypatch):
    calls: list[str] = []
    _stub_llm(monkeypatch, INTENT["EXPLAIN"], calls)
    result = A.answer(None, "我是不是有抑郁症", {}, [], None)
    assert result["intent"] == INTENT["BOUNDARY"]
    assert result["intentSource"] == "rule"
    assert calls == []


def test_model_failure_behaves_exactly_like_no_feature(monkeypatch):
    calls: list[str] = []
    _stub_llm(monkeypatch, None, calls)
    before = classify("我跟以前比呢")["intent"]
    result = A.answer(None, "我跟以前比呢", {}, [], None)
    assert result["intent"] == before
    assert result["intentSource"] == "rule"
    assert calls, "兜底确实被调用过，只是失败了"


# ---------------------------------------------------------------------------
# 第 4 条不变式：改判必须与可支撑的数据相容（真实模型实测发现的缺陷）
# ---------------------------------------------------------------------------


def test_model_cannot_route_to_trend_without_two_comparable_sessions():
    """实测：「那个呢」被模型猜成 trend，用户收到"还没有两次可比的测评"，比追问更误导。"""
    intent, source = resolve_intent(
        {"intent": INTENT["CLARIFY"]}, INTENT["TREND"], has_facts=True, has_trend=False
    )
    assert intent == INTENT["CLARIFY"] and source == "rule"

    intent, source = resolve_intent(
        {"intent": INTENT["CLARIFY"]}, INTENT["TREND"], has_facts=True, has_trend=True
    )
    assert intent == INTENT["TREND"] and source == "llm"


def test_model_cannot_route_to_data_answers_without_any_results():
    for target in (INTENT["EXPLAIN"], INTENT["SUMMARY"]):
        intent, source = resolve_intent({"intent": INTENT["CLARIFY"]}, target, has_facts=False)
        assert intent == INTENT["CLARIFY"] and source == "rule", target
        intent, source = resolve_intent(
            {"intent": INTENT["CLARIFY"]}, target, has_facts=True, has_trend=True
        )
        assert intent == target and source == "llm", target


def test_underspecified_question_stays_clarify_end_to_end(monkeypatch):
    """没有两次记录时，即使模型硬猜 trend，最终也不能切场景。"""
    _stub_llm(monkeypatch, INTENT["TREND"], [])
    result = A.answer(None, "那个呢", {}, [], None)  # facts 为空 → 无 trend
    assert result["intent"] != INTENT["TREND"] or result["intentSource"] == "rule"


@pytest.mark.parametrize("question", ["我有点担心自己", "最近状态一直不好", "我心情很差", "我太焦虑了"])
def test_self_concern_is_support_not_clarify(question):
    """第 3 轮实测：用户在表达困扰，系统回「你指的是哪一项？」—— 体验最差的一类。"""
    assert classify(question)["intent"] == INTENT["SUPPORT"], question


@pytest.mark.parametrize("question", ["这东西准吗", "这个测评可信吗", "准不准啊", "有信度吗", "这科学吗"])
def test_reliability_questions_are_explain_not_support(question):
    """第 3 轮实测的第二个误判：「这东西准吗」被模型判成 support，回了"你最近状态不太好"。

    问的是测评本身，不是用户的情绪 —— 这类必须由关键词接住（0ms，且不给模型猜错的机会）。
    """
    result = classify(question)
    assert result["intent"] == INTENT["EXPLAIN"], (question, result)
    assert not needs_llm_fallback(result), "已经由关键词确定，不该再交给模型"


def test_clinical_words_still_win_over_support():
    """「焦虑症」必须仍是 boundary（要就医的专业判断），不能被 support 词表抢走。"""
    assert classify("我是不是有焦虑症")["intent"] == INTENT["BOUNDARY"]


def test_classifier_prompt_forbids_guessing():
    from app.agent.intent_llm import SYSTEM_PROMPT

    assert "不要靠猜" in SYSTEM_PROMPT
    assert "support" in SYSTEM_PROMPT and "担心自己" in SYSTEM_PROMPT


def test_llm_trend_rescue_switches_scene(monkeypatch):
    """模型判成 trend 且确实有可比记录时，校验策略必须跟着切到趋势场景。"""
    _stub_llm(monkeypatch, INTENT["TREND"], [])
    facts = {
        "vc": {"correct": 5, "total": 8, "score": 50},
        "trend": {"days": 9, "rows": [{"id": "vc", "prev": 40, "next": 50, "delta": 10}]},
    }
    result = A.answer(None, "我跟以前比呢", facts, [], None)
    assert result["intent"] == INTENT["TREND"]
    assert result["intentSource"] == "llm"


def test_report_scene_skips_classification(monkeypatch):
    calls: list[str] = []
    _stub_llm(monkeypatch, INTENT["SUMMARY"], calls)
    facts = {"vc": {"correct": 5, "total": 8, "score": 50}}
    result = A.answer(None, "这份报告怎么读", facts, [], None, scene="report")
    assert result["intentSource"] == "scene"
    assert calls == []


# ---------------------------------------------------------------------------
# 未配置模型时：整条链路必须与没有这个功能时一致
# ---------------------------------------------------------------------------


def test_no_key_means_no_network_call(monkeypatch):
    from app import llm as L

    monkeypatch.setattr(
        L, "site_llm_config", lambda: L.LLMConfig(endpoint="", model="", key="", enabled=False)
    )
    assert classify_with_llm("我到底怎么样") is None


def test_unparseable_model_output_is_ignored(monkeypatch):
    from app import llm as L

    config = L.LLMConfig(endpoint="https://x.invalid/v1", model="m", key="k", enabled=True)
    monkeypatch.setattr(L, "site_llm_config", lambda: config)

    def boom(*args, **kwargs):
        raise L.LLMError("timeout", "超时")

    monkeypatch.setattr(L, "call_llm_with_fallback", boom)
    assert classify_with_llm("我到底怎么样") is None
