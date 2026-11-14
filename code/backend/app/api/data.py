from __future__ import annotations

import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .. import keyring_store
from ..config import settings
from ..db import get_db
from ..logging_setup import redact_text
from ..models import (
    AISettings,
    AppState,
    ChatMessage,
    MemoryAdvice,
    MemoryProfile,
    MemorySummary,
)
from ..serializers import export_payload, memory_payload
from ..timeutil import parse_dt

router = APIRouter()


def backup_database() -> Path:
    if not settings.pg_dump:
        raise RuntimeError("pg_dump_not_configured")
    backup_dir = Path(settings.data_dir) / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    target = backup_dir / f"mindmeter-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}.dump"
    env = dict(os.environ)
    if settings.pg_password:
        env["PGPASSWORD"] = settings.pg_password
    command = [
        settings.pg_dump,
        "-Fc",
        "-h",
        settings.pg_host,
        "-p",
        str(settings.pg_port),
        "-U",
        settings.pg_user,
        "-d",
        settings.pg_database,
        "-f",
        str(target),
    ]
    result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        raise RuntimeError(redact_text(result.stderr[-500:]))
    return target


@router.get("/export")
def export_data(db: Session = Depends(get_db)):
    return export_payload(db)


@router.post("/import")
def import_data(payload: dict = Body(...), db: Session = Depends(get_db)):
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    if not isinstance(data, dict) or data.get("schemaVersion") != 1:
        raise HTTPException(400, "unsupported_import_schema")
    try:
        backup = backup_database()
    except Exception as exc:
        return JSONResponse(
            {"error": "backup_failed", "message": str(exc)}, status_code=503
        )

    imported = {"sessions": 0, "messages": 0, "summaries": 0, "advice": 0, "profile": 0}
    skipped = {"sessions": 0, "messages": 0}
    warnings: list[str] = []
    if isinstance(data.get("settings"), dict) and (
        "apiKey" in data["settings"] or "api_key" in data["settings"]
    ):
        warnings.append("已忽略导入文件中的 LLM Key")

    for session in data.get("sessions") or []:
        if not isinstance(session, dict) or not session.get("id"):
            skipped["sessions"] += 1
            continue
        from ..models import Assessment

        if db.get(Assessment, str(session["id"])) is not None:
            skipped["sessions"] += 1
            continue
        from .assessments import create_assessment

        create_assessment({"session": session}, db)
        imported["sessions"] += 1

    app = data.get("app") if isinstance(data.get("app"), dict) else {}
    draft = data.get("draft") if isinstance(data.get("draft"), dict) else {}
    if app or draft:
        row = db.get(AppState, 1) or AppState(id=1)
        row.route = str(app.get("route") or "/")
        row.tier = app.get("tier") or draft.get("tier")
        row.consented = bool(app.get("consented"))
        row.consented_age = bool(app.get("consentedAge"))
        row.started_at = parse_dt(app.get("startedAt") or draft.get("updatedAt"))
        row.task_order = list(app.get("order") or draft.get("order") or [])
        row.cursor = int(app.get("cursor") or draft.get("cursor") or 0)
        row.results = app.get("results") or draft.get("results") or {}
        row.drafts = app.get("drafts") or draft.get("drafts") or {}
        db.add(row)

    memory = data.get("memory") if isinstance(data.get("memory"), dict) else {}
    profile = memory.get("profile") if isinstance(memory.get("profile"), dict) else {}
    if profile:
        row = db.get(MemoryProfile, 1) or MemoryProfile(id=1)
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
        row = db.get(MemorySummary, str(item["id"])) or MemorySummary(
            id=str(item["id"]), at=parse_dt(item.get("at")) or datetime.now(timezone.utc), tier="standard", text=""
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
        row = db.get(MemoryAdvice, str(item["id"])) or MemoryAdvice(
            id=str(item["id"]), at=parse_dt(item.get("at")) or datetime.now(timezone.utc)
        )
        row.at = parse_dt(item.get("at")) or row.at
        row.title = str(item.get("title") or "")
        row.shown = bool(item.get("shown", True))
        row.done = bool(item.get("done", False))
        db.add(row)
        imported["advice"] += 1

    current_seq = int(db.scalar(select(ChatMessage.seq).order_by(ChatMessage.seq.desc()).limit(1)) or 0)
    for item in (memory.get("messages") or [])[-20:]:
        if not isinstance(item, dict) or not item.get("id"):
            continue
        if db.get(ChatMessage, str(item["id"])) is not None:
            skipped["messages"] += 1
            continue
        current_seq += 1
        db.add(
            ChatMessage(
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

    settings_data = data.get("settings") if isinstance(data.get("settings"), dict) else {}
    if settings_data:
        row = db.get(AISettings, 1) or AISettings(id=1)
        row.endpoint = str(settings_data.get("endpoint") or "")
        row.model = str(settings_data.get("model") or "")
        row.enabled = bool(settings_data.get("enabled"))
        db.add(row)

    db.commit()
    return {
        "ok": True,
        "backup": str(backup),
        "imported": imported,
        "skipped": skipped,
        "warnings": warnings,
        "memory": memory_payload(db),
    }


@router.delete("/data")
def clear_data(db: Session = Depends(get_db)):
    for table in (
        "assessment_scores",
        "assessment_tasks",
        "assessments",
        "memory_summaries",
        "memory_advice",
        "chat_messages",
        "app_state",
        "ai_settings",
        "ai_runs",
        "audit_log",
    ):
        db.execute(text(f"DELETE FROM {table}"))
    db.commit()
    try:
        keyring_store.delete_llm_key()
    except keyring_store.KeyStoreError:
        pass
    return {"ok": True}


@router.get("/logs")
def logs(limit: int = 200):
    path = Path(settings.data_dir) / "logs" / "backend.log"
    if not path.exists():
        return {"schemaVersion": 1, "count": 0, "logs": []}
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()[-max(1, min(limit, 500)) :]
    return {
        "schemaVersion": 1,
        "count": len(lines),
        "logs": [redact_text(line) for line in lines],
    }
