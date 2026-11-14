from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..agent import answer
from ..privacy import find_sensitive, redact
from ..db import get_db
from ..models import (
    AIRun,
    Assessment,
    ChatMessage,
    MemoryAdvice,
    MemoryProfile,
    MemorySummary,
)
from ..serializers import assessment_to_session, memory_payload, sessions_payload
from ..timeutil import parse_dt
from ..trend import build_trend_payload

router = APIRouter()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _next_seq(db: Session) -> int:
    current = db.scalar(select(ChatMessage.seq).order_by(ChatMessage.seq.desc()).limit(1))
    return int(current or 0) + 1


def _facts(db: Session) -> tuple[dict, str | None]:
    row = db.scalar(
        select(Assessment)
        .where(Assessment.status == "completed")
        .order_by(Assessment.finished_at.desc().nullslast())
        .limit(1)
    )
    if row is None:
        return {}, None
    session = assessment_to_session(db, row)
    facts = {}
    for dim, payload in (session.get("results") or {}).items():
        if isinstance(payload, dict) and isinstance(payload.get("metrics"), dict):
            facts[dim] = dict(payload["metrics"])
            score = (session.get("scores") or {}).get(dim)
            if isinstance(score, int):
                facts[dim]["score"] = score
    # 趋势数据挂在专用键下：delta/days 随 collect_numbers 进入校验白名单。
    trend = build_trend_payload(sessions_payload(db, limit=2)["sessions"])
    if trend is not None:
        facts["trend"] = trend
    return facts, row.id


def _memory_context(db: Session) -> dict:
    profile_row = db.get(MemoryProfile, 1)
    profile = None
    if profile_row is not None and profile_row.confirmed:
        profile = {
            "goal": profile_row.goal,
            "preference": profile_row.preference,
            "constraint": profile_row.constraint,
            "confirmed": True,
        }
    latest = db.scalar(select(MemorySummary).order_by(MemorySummary.at.desc()).limit(1))
    advice = list(
        db.scalars(select(MemoryAdvice).order_by(MemoryAdvice.at.desc()).limit(5)).all()
    )
    return {
        "profile": profile,
        "summaryText": latest.text if latest else None,
        "advice": [
            {"id": item.id, "title": item.title, "done": item.done} for item in reversed(advice)
        ],
    }


def _history(db: Session) -> list[dict]:
    rows = list(
        db.scalars(select(ChatMessage).order_by(ChatMessage.seq.desc()).limit(6)).all()
    )
    return [
        {"role": row.role, "content": row.content}
        for row in reversed(rows)
    ]


def _append(
    db: Session,
    role: str,
    content: str,
    *,
    source=None,
    citations=None,
    code=None,
    risk=None,
) -> ChatMessage:
    seq = _next_seq(db)
    row = ChatMessage(
        id=f"msg_{int(_now().timestamp() * 1000)}_{seq}",
        role=role,
        content=content,
        source=source,
        citations=citations or [],
        code=code,
        risk=risk,
        at=_now(),
        seq=seq,
    )
    db.add(row)
    db.flush()
    keep = list(
        db.scalars(select(ChatMessage.id).order_by(ChatMessage.seq.desc()).limit(20)).all()
    )
    if keep:
        db.execute(delete(ChatMessage).where(ChatMessage.id.not_in(keep)))
    return row


@router.get("/chat/messages")
def messages(db: Session = Depends(get_db)):
    return {"schemaVersion": 1, "messages": memory_payload(db)["messages"]}


@router.post("/chat/messages")
def append_message(payload: dict = Body(...), db: Session = Depends(get_db)):
    role = "assistant" if payload.get("role") == "assistant" else "user"
    content = str(payload.get("content") or "")
    if not content:
        raise HTTPException(400, "empty_message")
    row = _append(
        db,
        role,
        content,
        source=payload.get("source"),
        citations=payload.get("citations") or [],
        code=payload.get("code"),
        risk=payload.get("risk"),
    )
    db.commit()
    return {"id": row.id}


@router.post("/chat")
def chat(payload: dict = Body(...), db: Session = Depends(get_db)):
    question = str(payload.get("question") or "").strip()
    if not question:
        raise HTTPException(400, "empty_question")
    facts, assessment_id = _facts(db)
    memory = _memory_context(db)
    history = _history(db)

    # PII is redacted before storage and never forwarded to a model.
    sensitive = find_sensitive(question)
    if sensitive:
        _append(db, "user", redact(question))
        result = {
            "intent": "privacy",
            "risk": "high",
            "text": (
                "我检测到你在消息里写了"
                + "、".join(sensitive)
                + "。这类个人信息不会被保存原文，也不会发送给模型。"
                "请只描述与测评相关的问题；如果已经发送过敏感信息，建议在设置里清除本机数据。"
            ),
            "citations": [],
            "sources": [],
            "source": "policy",
            "code": "pii_blocked",
        }
    else:
        # Persist the user turn before the model call so a crash still leaves the question.
        _append(db, "user", question)
        db.commit()
        result = answer(db, question, facts, history, memory)

    _append(
        db,
        "assistant",
        result.get("text", ""),
        source=result.get("source"),
        citations=result.get("sources") or result.get("citations") or [],
        code=result.get("code"),
        risk=result.get("risk"),
    )
    code = result.get("code")
    db.add(
        AIRun(
            assessment_id=assessment_id,
            model=result.get("model"),
            intent=result.get("intent"),
            latency_ms=result.get("latency_ms"),
            degraded=result.get("source") != "llm",
            error_code=None if code in (None, "ok") else str(code),
            validation=result.get("validation") or None,
        )
    )
    db.commit()

    if result.get("source") == "llm":
        for source in result.get("sources") or []:
            source_id = str(source.get("id") or "")
            if not source_id.startswith("kb-plan"):
                continue
            advice = db.get(MemoryAdvice, source_id) or MemoryAdvice(id=source_id, at=_now())
            advice.title = str(source.get("title") or "")
            advice.shown = True
            db.add(advice)
    db.commit()

    return {
        "reply": {
            "text": result.get("text", ""),
            "intent": result.get("intent", "explain"),
            "citations": result.get("citations", []),
            "sources": result.get("sources", []),
            "source": result.get("source", "template"),
            "code": result.get("code", "ok"),
            "risk": result.get("risk", "low"),
            "assessmentId": assessment_id,
        },
        "messages": memory_payload(db)["messages"],
    }
