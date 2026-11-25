from __future__ import annotations

import json

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .. import auth
from ..agent import answer
from ..db import get_db
from ..memory import MemoryStore
from ..models import AIRun, AppState, Assessment, User
from ..privacy import find_sensitive, redact
from ..serializers import (
    assessment_to_session,
    memory_payload,
    sessions_payload,
)
from ..trend import build_trend_payload

router = APIRouter()


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


@router.get("/chat/messages")
def messages(user: User = Depends(auth.require_user), db: Session = Depends(get_db)):
    return {"schemaVersion": 1, "messages": memory_payload(db, int(user.id))["messages"]}


@router.post("/chat/messages")
def append_message(
    payload: dict = Body(...),
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
):
    role = "assistant" if payload.get("role") == "assistant" else "user"
    content = str(payload.get("content") or "")
    if not content:
        raise HTTPException(400, "empty_message")
    row = MemoryStore(db, user).append(
        role,
        content,
        source=payload.get("source"),
        citations=payload.get("citations") or [],
        code=payload.get("code"),
        risk=payload.get("risk"),
    )
    db.commit()
    return {"id": row.id}


def _iter_text_chunks(text: str, size: int = 12):
    """把最终回答切成小块，供 SSE 逐段下发（前端做打字机效果）。"""
    value = str(text or "")
    for start in range(0, len(value), size):
        yield value[start : start + size]


@router.post("/chat/stream")
def chat_stream(
    payload: dict = Body(...),
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
):
    """可选：先走完同样的生成/校验，再把回答分块推给前端。

    生成逻辑与 `/chat` 完全一致（消息也会落库），只是传输方式不同；
    因此前端切流式不需要改后端行为。
    """
    result = chat(payload=payload, user=user, db=db)
    text = str((result.get("reply") or {}).get("text") or "")

    def event_stream():
        for chunk in _iter_text_chunks(text):
            yield f"data: {json.dumps({'delta': chunk}, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


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
    # 用户可在设置里关闭"记忆影响回答"：关闭后本次请求不注入画像/摘要/建议。
    use_memory = payload.get("useMemory", True)
    store = MemoryStore(db, user)
    facts, assessment_id, tier = _facts(db, uid)
    memory = store.context() if use_memory is not False else None
    history = store.history()

    # PII 在入库前脱敏，且绝不会发给模型。
    sensitive = find_sensitive(question)
    if sensitive:
        store.append("user", redact(question))
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
        # 先落库用户提问再调模型，崩溃时至少留下问题。
        store.append("user", question)
        db.commit()
        result = answer(db, question, facts, history, memory)

    store.append(
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
        sedimented = store.sediment(
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
            # 路由可观测性：rule=关键词命中，llm=兜底救了这次，scene=报告场景固定。
            "intentSource": result.get("intentSource", "rule"),
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
