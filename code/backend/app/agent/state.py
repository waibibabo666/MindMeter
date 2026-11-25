"""Typed state passed between LangGraph nodes."""
from __future__ import annotations

from typing import TypedDict

from sqlalchemy.orm import Session


class AgentState(TypedDict, total=False):
    question: str
    facts: dict
    history: list
    memory: dict
    scene: str
    intent: str
    matched: list
    # 意图来自关键词还是 LLM 兜底（rule | llm | scene）：调路由时最需要这条数据。
    intentSource: str
    chunks: list
    citations: list
    sources: list
    text: str
    source: str
    code: str
    risk: str
    model: str
    latency_ms: int
    validation: list
    valid: bool
    issues: list
    # 显式传入数据库会话，替代旧版 ContextVar 隐式传参。
    db: Session | None
