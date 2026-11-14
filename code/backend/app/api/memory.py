from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import delete
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import ChatMessage, MemoryAdvice, MemoryProfile, MemorySummary
from ..serializers import memory_payload
from ..timeutil import parse_dt

router = APIRouter()


def _now() -> datetime:
    return datetime.now(timezone.utc)


@router.get("/memory")
def get_memory(db: Session = Depends(get_db)):
    return memory_payload(db)


@router.put("/memory")
def replace_memory(payload: dict = Body(...), db: Session = Depends(get_db)):
    """Replace the small local memory snapshot (used by the frontend facade)."""
    profile = payload.get("profile") if isinstance(payload.get("profile"), dict) else {}
    row = db.get(MemoryProfile, 1) or MemoryProfile(id=1)
    row.goal = str(profile.get("goal") or "").strip()
    row.preference = str(profile.get("preference") or "").strip()
    row.constraint = str(profile.get("constraint") or "").strip()
    row.confirmed = bool(profile.get("confirmed"))
    row.confirmed_at = _now() if row.confirmed else None
    db.add(row)

    db.execute(delete(MemorySummary))
    for item in payload.get("summaries") or []:
        if not isinstance(item, dict) or not item.get("id"):
            continue
        lowest = item.get("lowest") or {}
        db.add(
            MemorySummary(
                id=str(item["id"]),
                at=parse_dt(item.get("at")) or _now(),
                tier=str(item.get("tier") or "standard"),
                lowest_dim=lowest.get("id") if isinstance(lowest, dict) else None,
                lowest_value=lowest.get("value") if isinstance(lowest, dict) else None,
                advice_ids=list(item.get("adviceIds") or []),
                text=str(item.get("text") or ""),
            )
        )

    db.execute(delete(MemoryAdvice))
    for item in payload.get("advice") or []:
        if not isinstance(item, dict) or not item.get("id"):
            continue
        db.add(
            MemoryAdvice(
                id=str(item["id"]),
                at=parse_dt(item.get("at")) or _now(),
                title=str(item.get("title") or ""),
                shown=bool(item.get("shown", True)),
                done=bool(item.get("done", False)),
            )
        )

    db.execute(delete(ChatMessage))
    for seq, item in enumerate((payload.get("messages") or [])[-20:], 1):
        if not isinstance(item, dict):
            continue
        db.add(
            ChatMessage(
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
    return memory_payload(db)


@router.delete("/memory")
def clear_memory(db: Session = Depends(get_db)):
    db.execute(delete(MemoryAdvice))
    db.execute(delete(MemorySummary))
    row = db.get(MemoryProfile, 1)
    if row is not None:
        row.goal = ""
        row.preference = ""
        row.constraint = ""
        row.confirmed = False
        row.confirmed_at = None
    db.commit()
    return {"ok": True}


@router.put("/memory/profile")
def put_profile(payload: dict = Body(...), db: Session = Depends(get_db)):
    row = db.get(MemoryProfile, 1) or MemoryProfile(id=1)
    row.goal = str(payload.get("goal") or "").strip()
    row.preference = str(payload.get("preference") or "").strip()
    row.constraint = str(payload.get("constraint") or "").strip()
    row.confirmed = bool(payload.get("confirmed"))
    row.confirmed_at = _now() if row.confirmed else None
    db.add(row)
    db.commit()
    return memory_payload(db)["profile"]


@router.delete("/memory/profile")
def delete_profile(db: Session = Depends(get_db)):
    row = db.get(MemoryProfile, 1)
    if row is not None:
        row.goal = ""
        row.preference = ""
        row.constraint = ""
        row.confirmed = False
        row.confirmed_at = None
    db.commit()
    return {"ok": True}


@router.post("/memory/summaries")
def put_summary(payload: dict = Body(...), db: Session = Depends(get_db)):
    summary_id = str(payload.get("id") or "")
    if not summary_id:
        raise HTTPException(400, "missing_id")
    row = db.get(MemorySummary, summary_id) or MemorySummary(id=summary_id, at=_now(), tier="standard", text="")
    row.at = parse_dt(payload.get("at")) or _now()
    row.tier = str(payload.get("tier") or "standard")
    lowest = payload.get("lowest") or {}
    row.lowest_dim = lowest.get("id") if isinstance(lowest, dict) else None
    row.lowest_value = lowest.get("value") if isinstance(lowest, dict) else None
    row.advice_ids = list(payload.get("adviceIds") or [])
    row.text = str(payload.get("text") or "")
    db.add(row)
    db.commit()
    return {"ok": True, "id": summary_id}


@router.delete("/memory/summaries/{summary_id}")
def delete_summary(summary_id: str, db: Session = Depends(get_db)):
    row = db.get(MemorySummary, summary_id)
    if row is not None:
        db.delete(row)
        db.commit()
    return {"ok": True}


@router.post("/memory/advice")
def put_advice(payload: dict = Body(...), db: Session = Depends(get_db)):
    advice_id = str(payload.get("id") or "")
    if not advice_id:
        raise HTTPException(400, "missing_id")
    row = db.get(MemoryAdvice, advice_id) or MemoryAdvice(id=advice_id, at=_now())
    row.at = parse_dt(payload.get("at")) or _now()
    row.title = str(payload.get("title") or "")
    row.shown = bool(payload.get("shown", True))
    row.done = bool(payload.get("done", False))
    db.add(row)
    db.commit()
    return {"ok": True, "id": advice_id}


@router.patch("/memory/advice/{advice_id}")
def patch_advice(advice_id: str, payload: dict = Body(...), db: Session = Depends(get_db)):
    row = db.get(MemoryAdvice, advice_id)
    if row is None:
        raise HTTPException(404, "advice_not_found")
    if "done" in payload:
        row.done = bool(payload["done"])
    db.commit()
    return {"ok": True}


@router.delete("/memory/advice/{advice_id}")
def delete_advice(advice_id: str, db: Session = Depends(get_db)):
    row = db.get(MemoryAdvice, advice_id)
    if row is not None:
        db.delete(row)
        db.commit()
    return {"ok": True}
