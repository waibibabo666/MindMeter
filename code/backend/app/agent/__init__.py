"""MindMeter agent public API.

The package is split by responsibility:

- ``state``       — the typed state passed between graph nodes
- ``graph``       — LangGraph orchestration (classify → retrieve → generate → validate)
- ``validation``  — pure output rules (numbers, citations, mechanisms, ratings)
- ``render``      — deterministic templates and prompt assembly
- ``classify``    — keyword intent routing (+ ``intent_llm`` fallback)
- ``policies``    — per-scene generation/validation policy (single source of truth)
- ``insights``    — after-turn memory sediment

Import from this package (or the submodule that owns the symbol); nothing else.
"""
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
    # state
    "AgentState",
    # graph
    "answer",
    # routing
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
    # validation
    "ability_rating_hits",
    "banned_word_hits",
    "chinese_measure_hits",
    "cn_number_to_float",
    "derived_allowed_numbers",
    "dimension_score_owners",
    "extract_numbers",
    "mechanism_hits",
    "validate_text",
    # render
    "build_messages",
    "memory_lines",
    "scene_template",
    "template_explanation",
]
