from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .. import auth
from ..agent import answer
from ..agent.insights import after_turn
from ..db import get_db
from ..models import (
    AIRun,
    AppState,
    Assessment,
    ChatMessage,
    MemoryAdvice,
    MemoryProfile,
    MemorySummary,
    User,
)
from ..privacy import find_sensitive, redact
from ..serializers import (
    assessment_to_session,
    memory_payload,
    sessions_payload,
)
from ..trend import build_trend_payload

router = APIRouter()

KEEP_MESSAGES = 20
HISTORY_MESSAGES = 6


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _next_seq(db: Session, user_id: int) -> int:
    current = db.scalar(
        select(ChatMessage.seq)
        .where(ChatMessage.user_id == user_id)
        .order_by(ChatMessage.seq.desc())
        .limit(1)
    )
    return int(current or 0) + 1


def _facts(db: Session, user_id: int) -> tuple[dict, str | None, str | None]:
    row = db.scalar(
        select(Assessment)
        .where(Assessment.user_id == user_id, Assessment.status == "completed")
        .order_by(Assessment.finished_at.desc().nullslast())
        .limit(1)
    )
    if row is None:
        tier = db.get(AppState, user_id)
        return {}, None, (tier.tier if tier else None)
    session = assessment_to_session(db, row)
    facts = {}
    for dim, payload in (session.get("results") or {}).items():
        if isinstance(payload, dict) and isinstance(payload.get("metrics"), dict):
            facts[dim] = dict(payload["metrics"])
            score = (session.get("scores") or {}).get(dim)
            if isinstance(score, int):
                facts[dim]["score"] = score
    # 趋势数据挂在专用键下：delta/days 随 collect_numbers 进入校验白名单。
    trend = build_trend_payload(sessions_payload(db, user_id, limit=2)["sessions"])
    if trend is not None:
        facts["trend"] = trend
    return facts, row.id, row.mode


def _memory_context(db: Session, user_id: int) -> dict:
    profile_row = db.get(MemoryProfile, user_id)
    profile = None
    if profile_row is not None and profile_row.confirmed:
        profile = {
            "goal": profile_row.goal,
            "preference": profile_row.preference,
            "constraint": profile_row.constraint,
            "confirmed": True,
        }
    latest = db.scalar(
        select(MemorySummary)
        .where(MemorySummary.user_id == user_id)
        .order_by(MemorySummary.at.desc())
        .limit(1)
    )
    advice = list(
        db.scalars(
            select(MemoryAdvice)
            .where(MemoryAdvice.user_id == user_id)
            .order_by(MemoryAdvice.at.desc())
            .limit(5)
        ).all()
    )
    return {
        "profile": profile,
        "summaryText": latest.text if latest else None,
        "advice": [
            {"id": item.id, "title": item.title, "done": item.done} for item in reversed(advice)
        ],
    }


def _history(db: Session, user_id: int) -> list[dict]:
    rows = list(
        db.scalars(
            select(ChatMessage)
            .where(ChatMessage.user_id == user_id)
            .order_by(ChatMessage.seq.desc())
            .limit(HISTORY_MESSAGES)
        ).all()
    )
    return [{"role": row.role, "content": row.content} for row in reversed(rows)]


def _append(
    db: Session,
    user_id: int,
    role: str,
    content: str,
    *,
    source=None,
    citations=None,
    code=None,
    risk=None,
) -> ChatMessage:
    seq = _next_seq(db, user_id)
    row = ChatMessage(
        user_id=user_id,
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
        db.scalars(
            select(ChatMessage.id)
            .where(ChatMessage.user_id == user_id)
            .order_by(ChatMessage.seq.desc())
            .limit(KEEP_MESSAGES)
        ).all()
    )
    if keep:
        db.execute(
            delete(ChatMessage).where(
                ChatMessage.user_id == user_id, ChatMessage.id.not_in(keep)
            )
        )
    return row


@router.get("/chat/messages")
def messages(user: User = Depends(auth.require_user), db: Session = Depends(get_db)):
    return {"schemaVersion": 1, "messages": memory_payload(db, int(user.id))["messages"]}


@router.post("/chat/messages")
def append_message(
    payload: dict = Body(...),
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
):
    uid = int(user.id)
    role = "assistant" if payload.get("role") == "assistant" else "user"
    content = str(payload.get("content") or "")
    if not content:
        raise HTTPException(400, "empty_message")
    row = _append(
        db,
        uid,
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
def chat(
    payload: dict = Body(...),
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
):
    uid = int(user.id)
    question = str(payload.get("question") or "").strip()
    if not question:
        raise HTTPException(400, "empty_question")
    facts, assessment_id, tier = _facts(db, uid)
    memory = _memory_context(db, uid)
    history = _history(db, uid)

    # PII is redacted before storage and never forwarded to a model.
    sensitive = find_sensitive(question)
    if sensitive:
        _append(db, uid, "user", redact(question))
        result = {
            "intent": "privacy",
            "risk": "high",
            "text": (
                "我检测到你在消息里写了"
                + "、".join(sensitive)
                + "。这类个人信息不会被保存原文，也不会发送给模型。"
                "请只描述与测评相关的问题；如果已经发送过敏感信息，可以在设置里清除本账号数据。"
            ),
            "citations": [],
            "sources": [],
            "source": "policy",
            "code": "pii_blocked",
        }
    else:
        # Persist the user turn before the model call so a crash still leaves the question.
        _append(db, uid, "user", question)
        db.commit()
        result = answer(db, question, facts, history, memory)

    _append(
        db,
        uid,
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
            user_id=uid,
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

    # 核心功能：一次有效对话结束后，服务端自己把摘要/建议沉淀进记忆表。
    # 任何一步出错都不能把已经成功的对话回答打挂，所以整体吞掉并记在响应标记里。
    try:
        sedimented = after_turn(
            db,
            user,
            question=question,
            reply=result,
            facts=facts,
            assessment_id=assessment_id,
            tier=tier,
        )
    except Exception:  # noqa: BLE001 - 记忆沉淀失败 ≠ 对话失败
        db.rollback()
        sedimented = {"memory": memory_payload(db, uid), "updated": False, "profileSuggested": None}

    memory_now = sedimented["memory"]
    return {
        "reply": {
            "text": result.get("text", ""),
            "intent": result.get("intent", "explain"),
            "citations": result.get("citations", []),
            "sources": result.get("sources", []),
            "source": result.get("source", "template"),
            # code 现在是真实原因（too_long / banned_word / unsourced_number /
            # score_misattributed / 模型侧 timeout…），前端 LLM_FALLBACK_REASON
            # 按这个值出中文；完整 issue 列表在 validation 里。
            "code": result.get("code", "ok"),
            "validation": result.get("validation") or [],
            "risk": result.get("risk", "low"),
            "assessmentId": assessment_id,
        },
        # `memory` 与 `GET /api/v1/memory` 同形状（memory_payload 一个来源）。
        # 为什么必须返回整份：前端 storage.js 的 writeMemory() 走的是
        # `PUT /memory` 全量替换，会先 DELETE 本账号的 summaries/advice 再重写。
        # 对话刚在服务端写入的摘要/建议如果让前端把旧快照 PUT 回来，就会被覆盖掉。
        # 所以对话页请改成「直接采用这里的 memory」，不要再 PUT 快照。
        "memory": memory_now,
        "memoryUpdated": bool(sedimented.get("updated")),
        # 画像线索：服务端一个字都没写，等用户在面板里确认（未确认不写是硬规矩）。
        "profileSuggested": sedimented.get("profileSuggested"),
        # 兼容旧前端：messages 仍是 memory.messages 的同一份。
        "messages": memory_now["messages"],
    }
