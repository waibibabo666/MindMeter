"""追问与概念纠偏的行为约束（2026-11-21）。

产品要求：
  * 用户表述里出现常见误解时，用一句话纠正，并给出下一步能问什么；
  * **不能连续纠正太多次**（一次对话最多 2 次），也不能靠模型自由发挥；
  * 纠正走确定性文案，不调用模型 —— 省 token。
"""
from __future__ import annotations

from app.agent import answer
from app.agent.classify import FIXED_REPLY, INTENT
from app.agent.misconceptions import (
    CORRECTION_PREFIX,
    MAX_CORRECTIONS,
    build_correction,
    correction_count,
    find_misconception,
    should_correct,
)

FACTS = {"am": {"hits": 4, "falseAlarms": 3, "score": 26}}


def _no_llm(*_args, **_kwargs):
    raise AssertionError("纠偏路径不应调用模型")


def test_misconception_rules_match_common_cases():
    assert find_misconception("八个维度就是八种智力吧")[1] == "kb-limit-02"
    assert find_misconception("这个分数等于智商吗")[1] == "kb-score-02"
    assert find_misconception("未测就是 0 分吧")[1] == "kb-score-04"
    assert find_misconception("测一次就定水平了吧")[1] == "kb-score-05"
    assert find_misconception("这个测评是诊断吗")[1] == "kb-limit-01"


def test_normal_question_has_no_correction():
    assert find_misconception("联想记忆怎么练") is None


def test_correction_is_bounded_by_history():
    history = [{"role": "assistant", "content": build_correction("x", "kb-score-02")}]
    assert correction_count(history) == 1
    assert should_correct("这个分数等于智商吗", history) is not None

    twice = history * MAX_CORRECTIONS
    assert correction_count(twice) == MAX_CORRECTIONS
    assert should_correct("这个分数等于智商吗", twice) is None


def test_correction_skips_model_and_cites_kb(monkeypatch):
    monkeypatch.setattr("app.agent.graph.call_llm_with_fallback", _no_llm)
    result = answer(None, "八个维度就是八种智力吧", FACTS, [], None, scene="chat_explain")
    assert result["source"] == "template"
    assert result["code"] == "correction"
    assert result["text"].startswith(CORRECTION_PREFIX)
    assert "kb-limit-02" in result["citations"]


def test_safety_intents_are_not_treated_as_misconceptions(monkeypatch):
    # 安全类问题必须走各自的固定话术，不能被"纠偏"抢走。
    monkeypatch.setattr("app.agent.graph.call_llm_with_fallback", _no_llm)
    boundary = answer(None, "我是不是得了抑郁症", FACTS, [], None, scene="chat_explain")
    assert boundary["intent"] == INTENT["BOUNDARY"]
    crisis = answer(None, "我不想活了", FACTS, [], None, scene="chat_explain")
    assert crisis["intent"] == INTENT["CRISIS"]


def test_clarify_reply_offers_next_questions():
    text = FIXED_REPLY[INTENT["CLARIFY"]]
    assert "联想记忆" in text
    assert "这次结果怎么读" in text
    assert len(text) <= 80  # 追问文案要短，别耗 token
