from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..agent import answer
from ..db import get_db
from ..models import (
    Assessment,
    ChatMessage,
    MemoryAdvice,
    MemoryProfile,
    MemorySummary,
)
from ..privacy import redact_pii
from ..serializers import assessment_to_session, memory_payload
from ..timeutil import parse_dt

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


def _append(db: Session, role: str, content: str, *, source=None, citations=None, code=None) -> ChatMessage:
    seq = _next_seq(db)
    row = ChatMessage(
        id=f"msg_{int(_now().timestamp() * 1000)}_{seq}",
        role=role,
        content=content,
        source=source,
        citations=citations or [],
        code=code,
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
    content = redact_pii(payload.get("content"))
    if not content:
        raise HTTPException(400, "empty_message")
    row = _append(
        db,
        role,
        content,
        source=payload.get("source"),
        citations=payload.get("citations") or [],
        code=payload.get("code"),
    )
    db.commit()
    return {"id": row.id}


@router.post("/chat")
def chat(payload: dict = Body(...), db: Session = Depends(get_db)):
    # 手机号 / 身份证号在入库、回显、导出前统一脱敏，避免随截图或导出文件外泄。
    raw_question = str(payload.get("question") or "").strip()
    question = redact_pii(raw_question)
    if not question:
        raise HTTPException(400, "empty_question")
    facts, assessment_id = _facts(db)
    memory = _memory_context(db)
    history = _history(db)

    # Persist the user turn before the model call so a crash still leaves the question.
    _append(db, "user", question)
    db.commit()

    result = answer(db, question, facts, history, memory)

    _append(
        db,
        "assistant",
        result.get("text", ""),
        source=result.get("source"),
        citations=result.get("citations") or [],
        code=result.get("code"),
    )

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
            "assessmentId": assessment_id,
        },
        "messages": memory_payload(db)["messages"],
    }
