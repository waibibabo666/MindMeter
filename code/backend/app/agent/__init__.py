"""MindMeter Agent 公共 API。

包内按职责分层：state（状态）、graph（编排）、validation（校验）、
render（模板与 prompt）、classify（路由）、policies（场景策略）、insights（记忆沉淀）。

对外统一从本包或拥有该符号的子模块导入。"""
from __future__ import annotations

from .classify import (
    FIXED_REPLY,
    GREETING_NO_FACTS,
    INTENT,
    NO_KNOWLEDGE_REPLY,
    RISK_BY_INTENT,
    SCOPE_BACKFILL,
    classify,
    fixed_reply,
    needs_llm_fallback,
    resolve_intent,
)
from .graph import answer
from .render import build_messages, memory_lines, scene_template, template_explanation
from .state import AgentState
from .validation import (
    ability_rating_hits,
    banned_word_hits,
    chinese_measure_hits,
    cn_number_to_float,
    derived_allowed_numbers,
    dimension_score_owners,
    extract_numbers,
    mechanism_hits,
    validate_text,
)

__all__ = [
    # 状态
    "AgentState",
    # 编排
    "answer",
    # 路由
    "INTENT",
    "FIXED_REPLY",
    "GREETING_NO_FACTS",
    "NO_KNOWLEDGE_REPLY",
    "RISK_BY_INTENT",
    "SCOPE_BACKFILL",
    "classify",
    "fixed_reply",
    "needs_llm_fallback",
    "resolve_intent",
    # 校验
    "ability_rating_hits",
    "banned_word_hits",
    "chinese_measure_hits",
    "cn_number_to_float",
    "derived_allowed_numbers",
    "dimension_score_owners",
    "extract_numbers",
    "mechanism_hits",
    "validate_text",
    # 渲染
    "build_messages",
    "memory_lines",
    "scene_template",
    "template_explanation",
]
