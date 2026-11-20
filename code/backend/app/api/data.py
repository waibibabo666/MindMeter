"""Per-account data portability: export, import, erasure, diagnostics.

The desktop build shelled out to ``pg_dump`` before an import. A hosted build
has an ephemeral filesystem and a managed database, so the backup is the
account's own export JSON plus Render's daily Postgres snapshot — documented in
docs/software/deploy-render.md.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session

from .. import auth
from ..config import settings
from ..db import get_db
from ..logging_setup import redact_text
from ..models import AppState, ChatMessage, MemoryAdvice, MemoryProfile, MemorySummary, User
from ..serializers import (
    clean_profile,
    export_payload,
    find_advice,
    find_message,
    find_summary,
    memory_payload,
)
from ..timeutil import parse_dt
from .assessments import persist_session

router = APIRouter()

USER_TABLES = (
    "app_state",
    "memory_summaries",
    "memory_advice",
    "memory_profile",
    "chat_messages",
    "ai_runs",
    "assessments",  # cascades assessment_tasks / assessment_scores
)


@router.get("/export")
def export_data(user: User = Depends(auth.require_user), db: Session = Depends(get_db)):
    """F-06: JSON download of this account's data. No passwords, no key."""
    return export_payload(db, int(user.id))


@router.post("/import")
def import_data(
    payload: dict = Body(...),
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
):
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    if not isinstance(data, dict) or data.get("schemaVersion") != 1:
        raise HTTPException(400, "unsupported_import_schema")
    uid = int(user.id)

    imported = {"sessions": 0, "messages": 0, "summaries": 0, "advice": 0, "profile": 0}
    skipped = {"sessions": 0, "messages": 0}
    warnings = ["导入前请先用「导出数据」保存本账号的当前数据（站点每天自动备份数据库）。"]
    if isinstance(data.get("settings"), dict) and (
        "apiKey" in data["settings"] or "api_key" in data["settings"]
    ):
        warnings.append("已忽略导入文件中的 LLM Key：模型由站点统一提供")

    for session in data.get("sessions") or []:
        if not isinstance(session, dict) or not session.get("id"):
            skipped["sessions"] += 1
            continue
        result = persist_session(db, uid, session)
        if result.get("idempotent"):
            skipped["sessions"] += 1
        else:
            imported["sessions"] += 1

    app = data.get("app") if isinstance(data.get("app"), dict) else {}
    draft = data.get("draft") if isinstance(data.get("draft"), dict) else {}
    if app or draft:
        row = db.get(AppState, uid) or AppState(user_id=uid)
        row.route = str(app.get("route") or "/")
        row.tier = app.get("tier") or draft.get("tier")
        row.consented = bool(app.get("consented"))
        row.consented_age = bool(app.get("consentedAge"))
        row.started_at = parse_dt(app.get("startedAt") or draft.get("updatedAt"))
        row.task_order = list(app.get("order") or draft.get("order") or [])
        row.cursor = int(app.get("cursor") or draft.get("cursor") or 0)
        row.results = app.get("results") or draft.get("results") or {}
        row.drafts = app.get("drafts") or draft.get("drafts") or {}
        if isinstance(app.get("profile"), dict):
            row.profile = clean_profile(app.get("profile"))
        db.add(row)

    memory = data.get("memory") if isinstance(data.get("memory"), dict) else {}
    profile = memory.get("profile") if isinstance(memory.get("profile"), dict) else {}
    if profile:
        row = db.get(MemoryProfile, uid) or MemoryProfile(user_id=uid)
        row.goal = str(profile.get("goal") or "")
        row.preference = str(profile.get("preference") or "")
        row.constraint = str(profile.get("constraint") or "")
        row.confirmed = bool(profile.get("confirmed"))
        row.confirmed_at = parse_dt(profile.get("confirmedAt"))
        db.add(row)
        imported["profile"] = 1

    for item in memory.get("summaries") or []:
        if not isinstance(item, dict) or not item.get("id"):
            continue
        row = find_summary(db, uid, str(item["id"])) or MemorySummary(
            user_id=uid,
            id=str(item["id"]),
            at=parse_dt(item.get("at")) or datetime.now(timezone.utc),
            tier="standard",
            text="",
        )
        row.at = parse_dt(item.get("at")) or row.at
        row.tier = str(item.get("tier") or "standard")
        lowest = item.get("lowest") or {}
        row.lowest_dim = lowest.get("id") if isinstance(lowest, dict) else None
        row.lowest_value = lowest.get("value") if isinstance(lowest, dict) else None
        row.advice_ids = list(item.get("adviceIds") or [])
        row.text = str(item.get("text") or "")
        db.add(row)
        imported["summaries"] += 1

    for item in memory.get("advice") or []:
        if not isinstance(item, dict) or not item.get("id"):
            continue
        row = find_advice(db, uid, str(item["id"])) or MemoryAdvice(
            user_id=uid, id=str(item["id"]), at=parse_dt(item.get("at")) or datetime.now(timezone.utc)
        )
        row.at = parse_dt(item.get("at")) or row.at
        row.title = str(item.get("title") or "")
        row.shown = bool(item.get("shown", True))
        row.done = bool(item.get("done", False))
        db.add(row)
        imported["advice"] += 1

    current_seq = int(
        db.scalar(
            select(ChatMessage.seq)
            .where(ChatMessage.user_id == uid)
            .order_by(ChatMessage.seq.desc())
            .limit(1)
        )
        or 0
    )
    for item in (memory.get("messages") or [])[-20:]:
        if not isinstance(item, dict) or not item.get("id"):
            continue
        if find_message(db, uid, str(item["id"])) is not None:
            skipped["messages"] += 1
            continue
        current_seq += 1
        db.add(
            ChatMessage(
                user_id=uid,
                id=str(item["id"]),
                role="assistant" if item.get("role") == "assistant" else "user",
                content=str(item.get("content") or ""),
                source=item.get("source"),
                citations=item.get("citations") or [],
                code=item.get("code"),
                at=parse_dt(item.get("at")) or datetime.now(timezone.utc),
                seq=current_seq,
            )
        )
        imported["messages"] += 1

    db.commit()
    return {
        "ok": True,
        "backup": None,
        "imported": imported,
        "skipped": skipped,
        "warnings": warnings,
        "memory": memory_payload(db, uid),
    }


@router.delete("/data")
def clear_data(user: User = Depends(auth.require_user), db: Session = Depends(get_db)):
    """Erase this account's product data. Other accounts are never touched."""
    uid = int(user.id)
    for table in USER_TABLES:
        db.execute(text(f"DELETE FROM {table} WHERE user_id = :uid"), {"uid": uid})
    db.commit()
    return {"ok": True}


@router.get("/logs")
def logs(limit: int = 200, user: User = Depends(auth.require_user)):
    """Diagnostics are off by default on a shared host (MM_EXPOSE_LOGS=1 to enable)."""
    if not settings.expose_logs:
        raise HTTPException(403, "logs_disabled")
    path = Path(settings.data_dir) / "logs" / "backend.log"
    if not path.exists():
        return {"schemaVersion": 1, "count": 0, "logs": []}
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()[
        -max(1, min(limit, 500)) :
    ]
    return {"schemaVersion": 1, "count": len(lines), "logs": [redact_text(line) for line in lines]}
