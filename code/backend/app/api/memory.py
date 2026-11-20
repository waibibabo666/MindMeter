from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import delete
from sqlalchemy.orm import Session

from .. import auth
from ..db import get_db
from ..models import ChatMessage, MemoryAdvice, MemoryProfile, MemorySummary, User
from ..serializers import find_advice, find_message, find_summary, memory_payload
from ..timeutil import parse_dt

router = APIRouter()


def _now() -> datetime:
    return datetime.now(timezone.utc)


@router.get("/memory")
def get_memory(user: User = Depends(auth.require_user), db: Session = Depends(get_db)):
    return memory_payload(db, int(user.id))


@router.put("/memory")
def replace_memory(
    payload: dict = Body(...),
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
):
    """Replace this account's memory snapshot (used by the frontend facade).

    警告（写给前端与服务端两边）：这里是**整份替换** —— 先 DELETE 本账号的
    summaries/advice/messages，再按传入快照重写。`POST /chat` 会在服务端沉淀摘要与建议
    并把最新的整份 `memory` 放在响应里（形状与本接口返回的一致），所以对话页请**采用
    响应里的 memory 更新缓存**，不要把旧快照 PUT 回来，否则刚写下的记忆会被抹掉。
    """
    uid = int(user.id)
    profile = payload.get("profile") if isinstance(payload.get("profile"), dict) else {}
    row = db.get(MemoryProfile, uid) or MemoryProfile(user_id=uid)
    row.goal = str(profile.get("goal") or "").strip()
    row.preference = str(profile.get("preference") or "").strip()
    row.constraint = str(profile.get("constraint") or "").strip()
    row.confirmed = bool(profile.get("confirmed"))
    row.confirmed_at = _now() if row.confirmed else None
    db.add(row)

    db.execute(delete(MemorySummary).where(MemorySummary.user_id == uid))
    for item in payload.get("summaries") or []:
        if not isinstance(item, dict) or not item.get("id"):
            continue
        lowest = item.get("lowest") or {}
        db.add(
            MemorySummary(
                user_id=uid,
                id=str(item["id"]),
                at=parse_dt(item.get("at")) or _now(),
                tier=str(item.get("tier") or "standard"),
                assessment_id=item.get("assessmentId"),
                lowest_dim=lowest.get("id") if isinstance(lowest, dict) else None,
                lowest_value=lowest.get("value") if isinstance(lowest, dict) else None,
                advice_ids=list(item.get("adviceIds") or []),
                text=str(item.get("text") or ""),
            )
        )

    db.execute(delete(MemoryAdvice).where(MemoryAdvice.user_id == uid))
    for item in payload.get("advice") or []:
        if not isinstance(item, dict) or not item.get("id"):
            continue
        db.add(
            MemoryAdvice(
                user_id=uid,
                id=str(item["id"]),
                at=parse_dt(item.get("at")) or _now(),
                title=str(item.get("title") or ""),
                shown=bool(item.get("shown", True)),
                done=bool(item.get("done", False)),
            )
        )

    db.execute(delete(ChatMessage).where(ChatMessage.user_id == uid))
    for seq, item in enumerate((payload.get("messages") or [])[-20:], 1):
        if not isinstance(item, dict):
            continue
        db.add(
            ChatMessage(
                user_id=uid,
                id=str(item.get("id") or f"msg_{seq}"),
                role="assistant" if item.get("role") == "assistant" else "user",
                content=str(item.get("content") or ""),
                source=item.get("source"),
                citations=item.get("citations") or [],
                code=item.get("code"),
                at=parse_dt(item.get("at")) or _now(),
                seq=seq,
            )
        )
    db.commit()
    return memory_payload(db, uid)


@router.delete("/memory")
def clear_memory(user: User = Depends(auth.require_user), db: Session = Depends(get_db)):
    uid = int(user.id)
    db.execute(delete(MemoryAdvice).where(MemoryAdvice.user_id == uid))
    db.execute(delete(MemorySummary).where(MemorySummary.user_id == uid))
    row = db.get(MemoryProfile, uid)
    if row is not None:
        row.goal = ""
        row.preference = ""
        row.constraint = ""
        row.confirmed = False
        row.confirmed_at = None
    db.commit()
    return {"ok": True}


@router.put("/memory/profile")
def put_profile(
    payload: dict = Body(...),
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
):
    uid = int(user.id)
    row = db.get(MemoryProfile, uid) or MemoryProfile(user_id=uid)
    row.goal = str(payload.get("goal") or "").strip()
    row.preference = str(payload.get("preference") or "").strip()
    row.constraint = str(payload.get("constraint") or "").strip()
    row.confirmed = bool(payload.get("confirmed"))
    row.confirmed_at = _now() if row.confirmed else None
    db.add(row)
    db.commit()
    return memory_payload(db, uid)["profile"]


@router.delete("/memory/profile")
def delete_profile(user: User = Depends(auth.require_user), db: Session = Depends(get_db)):
    uid = int(user.id)
    row = db.get(MemoryProfile, uid)
    if row is not None:
        row.goal = ""
        row.preference = ""
        row.constraint = ""
        row.confirmed = False
        row.confirmed_at = None
    db.commit()
    return {"ok": True}


@router.post("/memory/summaries")
def put_summary(
    payload: dict = Body(...),
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
):
    uid = int(user.id)
    summary_id = str(payload.get("id") or "")
    if not summary_id:
        raise HTTPException(400, "missing_id")
    row = find_summary(db, uid, summary_id) or MemorySummary(
        user_id=uid, id=summary_id, at=_now(), tier="standard", text=""
    )
    row.at = parse_dt(payload.get("at")) or _now()
    row.tier = str(payload.get("tier") or "standard")
    if payload.get("assessmentId"):
        row.assessment_id = str(payload["assessmentId"])
    lowest = payload.get("lowest") or {}
    row.lowest_dim = lowest.get("id") if isinstance(lowest, dict) else None
    row.lowest_value = lowest.get("value") if isinstance(lowest, dict) else None
    row.advice_ids = list(payload.get("adviceIds") or [])
    row.text = str(payload.get("text") or "")
    db.add(row)
    db.commit()
    return {"ok": True, "id": summary_id}


@router.delete("/memory/summaries/{summary_id}")
def delete_summary(
    summary_id: str,
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
):
    row = find_summary(db, int(user.id), summary_id)
    if row is not None:
        db.delete(row)
        db.commit()
    return {"ok": True}


@router.post("/memory/advice")
def put_advice(
    payload: dict = Body(...),
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
):
    uid = int(user.id)
    advice_id = str(payload.get("id") or "")
    if not advice_id:
        raise HTTPException(400, "missing_id")
    row = find_advice(db, uid, advice_id) or MemoryAdvice(user_id=uid, id=advice_id, at=_now())
    row.at = parse_dt(payload.get("at")) or _now()
    row.title = str(payload.get("title") or "")
    row.shown = bool(payload.get("shown", True))
    row.done = bool(payload.get("done", False))
    db.add(row)
    db.commit()
    return {"ok": True, "id": advice_id}


@router.patch("/memory/advice/{advice_id}")
def patch_advice(
    advice_id: str,
    payload: dict = Body(...),
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
):
    row = find_advice(db, int(user.id), advice_id)
    if row is None:
        raise HTTPException(404, "advice_not_found")
    if "done" in payload:
        row.done = bool(payload["done"])
    db.commit()
    return {"ok": True}


@router.delete("/memory/advice/{advice_id}")
def delete_advice(
    advice_id: str,
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
):
    row = find_advice(db, int(user.id), advice_id)
    if row is not None:
        db.delete(row)
        db.commit()
    return {"ok": True}


@router.delete("/memory/messages/{message_id}")
def delete_message(
    message_id: str,
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
):
    """删单条对话。

    记忆页早就支持"逐条删除"，但前端当时只能用 `PUT /memory` 全量快照去实现，
    而那会把服务端在对话结束时自动沉淀的摘要/建议一并抹掉。补这个单行接口，
    让记忆面板的所有写路径都是定向的。
    """
    row = find_message(db, int(user.id), message_id)
    if row is None:
        raise HTTPException(404, "message_not_found")
    db.delete(row)
    db.commit()
    return {"ok": True}
