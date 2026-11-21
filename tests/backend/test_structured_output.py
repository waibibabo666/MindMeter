"""结构化输出与记忆注入开关（2026-11-21）。

  * `MM_LLM_STRUCTURED=1` 时让模型输出 JSON，解析失败自动回退纯文本；
  * `MM_MEMORY_IN_PROMPT=0` 时不把记忆注入回答（用户可控的隐私开关）。
"""
from __future__ import annotations

from app.agent.structured import STRUCTURED_INSTRUCTION, parse_structured

ALLOWED = ["kb-dim-am-01", "kb-factor-01"]


def test_parse_structured_valid():
    raw = '{"answer": "联想记忆这一项命中 4 个。", "citations": ["kb-dim-am-01"], "basis": "按场景分组"}'
    parsed = parse_structured(raw, ALLOWED)
    assert parsed is not None
    assert "命中 4 个" in parsed["text"]
    assert parsed["citations"] == ["kb-dim-am-01"]
    assert "引用：kb-dim-am-01" in parsed["text"]
    assert "依据：按场景分组" in parsed["text"]


def test_parse_structured_strips_code_fence():
    raw = '```json\n{"answer": "好", "citations": []}\n```'
    assert parse_structured(raw, ALLOWED)["text"] == "好"


def test_parse_structured_rejects_bad_input():
    assert parse_structured("这不是 JSON", ALLOWED) is None
    assert parse_structured('{"citations": []}', ALLOWED) is None  # 缺 answer
    assert parse_structured('{"answer": "  "}', ALLOWED) is None  # 空回答
    assert parse_structured("{bad json}", ALLOWED) is None


def test_parse_structured_drops_unknown_citations():
    raw = '{"answer": "好", "citations": ["kb-fake-01", "kb-factor-01"]}'
    parsed = parse_structured(raw, ALLOWED)
    assert parsed["citations"] == ["kb-factor-01"]


def test_structured_instruction_is_json_only():
    assert "JSON" in STRUCTURED_INSTRUCTION
    assert "citations" in STRUCTURED_INSTRUCTION
