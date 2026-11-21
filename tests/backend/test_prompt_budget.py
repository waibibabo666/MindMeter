"""Prompt 预算与引用可解释性（2026-11-21）。

  * 知识块只给前 3 块、每块截断，问题截断，整体有字符上限 —— 控 token、降延迟；
  * 引用要说明"支撑了哪个结论"，不能只丢编号。
"""
from __future__ import annotations

from app.analysis import (
    MAX_CHUNKS_IN_PROMPT,
    MAX_PROMPT_CHARS,
    build_messages,
)
from app.agent.policies import prompt_for

FACTS = {"am": {"hits": 4, "falseAlarms": 3, "score": 26}}
CHUNKS = [
    {"id": f"kb-dim-am-0{i}", "title": f"联想记忆块{i}", "text": "很长的正文" * 60} for i in range(1, 9)
]


def test_prompt_only_keeps_top_chunks():
    body = build_messages(FACTS, CHUNKS, "联想记忆为什么低")[1]["content"]
    for index in range(1, MAX_CHUNKS_IN_PROMPT + 1):
        assert f"kb-dim-am-0{index}" in body
    # 第 4 块之后不应出现
    assert "kb-dim-am-04" not in body


def test_prompt_stays_within_budget():
    body = build_messages(FACTS, CHUNKS, "联想记忆为什么低" * 30)[1]["content"]
    assert len(body) <= MAX_PROMPT_CHARS + 1, len(body)
    assert "…" in body  # 被截断


def test_prompt_question_is_clipped():
    body = build_messages(FACTS, CHUNKS, "问" * 200)[1]["content"]
    assert "问" * 200 not in body


def test_citation_must_explain_support():
    prompt = prompt_for("chat_explain")
    assert "支撑" in prompt
    assert "依据" in prompt
