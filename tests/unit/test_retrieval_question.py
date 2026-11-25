"""检索与口语映射（2026-11-21）。

问题：
  * `retrieve_context` 只看弱项维度，用户原话从不参与检索；
  * 用户说「记性差」「反应慢」时识别不出维度。
"""
from __future__ import annotations

from app import analysis
from app.agent import classify
from app.agent.classify import dims_in_question

FACTS = {"vc": {"total": 8, "correct": 5, "score": 62}, "am": {"hits": 4, "falseAlarms": 3, "score": 26}}


def test_colloquial_dimension_words_map_to_ids():
    assert dims_in_question("我最近记性差") == ["am"]
    assert dims_in_question("反应慢怎么办") == ["ps"]
    assert dims_in_question("我算数老出错") == ["nc"]
    assert dims_in_question("方向感很差") == ["sv"]


def test_colloquial_question_is_answered_not_clarified():
    # 口语化的问题不能再回「你指的是哪一项」；问建议走 summary，问原因走 explain。
    assert classify("记性差怎么办")["intent"] in {"summary", "explain"}
    assert classify("反应慢能练吗")["intent"] in {"summary", "explain"}
    assert classify("为什么我记性差")["intent"] == "explain"


def test_retrieval_includes_question_text(monkeypatch):
    seen: list[str] = []

    def fake_retrieve(db, query, limit=2):
        seen.append(query)
        return []

    monkeypatch.setattr(analysis, "retrieve", fake_retrieve)
    analysis.retrieve_context(None, FACTS, limit=8, question="工作记忆是什么")
    joined = " | ".join(seen)
    assert "工作记忆是什么" in joined, joined
    # 问题点到的维度（口语）也要补查询
    assert any("联想记忆" in q for q in seen), seen


def test_retrieval_without_question_still_works(monkeypatch):
    monkeypatch.setattr(analysis, "retrieve", lambda db, query, limit=2: [])
    result = analysis.retrieve_context(None, FACTS, limit=8)
    assert result == []
