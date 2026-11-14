"""Convert database rows to the legacy frontend JSON shapes.

Keeping these shapes stable lets the frozen pages keep their rendering code.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import keyring_store
from .models import (
    AISettings,
    AppState,
    Assessment,
    AssessmentScore,
    AssessmentTask,
    ChatMessage,
    MemoryAdvice,
    MemoryProfile,
    MemorySummary,
)
from .scoring import DIMENSION_IDS


def iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat()


def ms(value: datetime | None) -> int | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return int(value.timestamp() * 1000)


def default_state() -> dict:
    return {
        "version": 1,
        "route": "/",
        "tier": None,
        "consented": False,
        "consentedAge": False,
        "startedAt": None,
        "order": [],
        "cursor": 0,
        "results": {},
        "drafts": {},
    }


def state_payload(db: Session) -> dict:
    row = db.get(AppState, 1)
    if row is None:
        return default_state()
    return {
        "version": 1,
        "route": row.route or "/",
        "tier": row.tier,
        "consented": bool(row.consented),
        "consentedAge": bool(row.consented_age),
        "startedAt": ms(row.started_at),
        "order": list(row.task_order or []),
        "cursor": int(row.cursor or 0),
        "results": row.results or {},
        "drafts": row.drafts or {},
    }


def assessment_to_session(db: Session, assessment: Assessment) -> dict:
    tasks = list(
        db.scalars(
            select(AssessmentTask)
            .where(AssessmentTask.assessment_id == assessment.id)
            .order_by(AssessmentTask.position)
        ).all()
    )
    results = {
        task.task_id: {"metrics": task.metrics or {}, "answers": task.answers or []}
        for task in tasks
    }
    score_rows = list(
        db.scalars(
            select(AssessmentScore).where(AssessmentScore.assessment_id == assessment.id)
        ).all()
    )
    scores = {dim: None for dim in DIMENSION_IDS}
    for row in score_rows:
        scores[row.dimension] = row.score
    return {
        "id": assessment.id,
        "mode": assessment.mode,
        "finishedAt": iso(assessment.finished_at),
        "dims": list(assessment.dims or []),
        "results": results,
        "scores": scores,
        "scoringVersion": assessment.scoring_version,
    }


def sessions_payload(db: Session, limit: int = 50) -> dict:
    rows = list(
        db.scalars(
            select(Assessment)
            .where(Assessment.status == "completed")
            .order_by(Assessment.finished_at.desc().nullslast())
            .limit(limit)
        ).all()
    )
    return {"schemaVersion": 1, "sessions": [assessment_to_session(db, row) for row in rows]}


def memory_payload(db: Session, message_limit: int = 20) -> dict:
    profile_row = db.get(MemoryProfile, 1)
    profile = {}
    if profile_row is not None:
        profile = {
            "goal": profile_row.goal,
            "preference": profile_row.preference,
            "constraint": profile_row.constraint,
            "confirmed": bool(profile_row.confirmed),
        }
        if profile_row.confirmed_at:
            profile["confirmedAt"] = ms(profile_row.confirmed_at)
    summaries = [
        {
            "id": row.id,
            "at": ms(row.at),
            "tier": row.tier,
            "lowest": {"id": row.lowest_dim, "value": row.lowest_value},
            "adviceIds": list(row.advice_ids or []),
            "text": row.text,
        }
        for row in db.scalars(select(MemorySummary).order_by(MemorySummary.at)).all()
    ]
    advice = [
        {
            "id": row.id,
            "at": ms(row.at),
            "title": row.title,
            "shown": bool(row.shown),
            "done": bool(row.done),
        }
        for row in db.scalars(select(MemoryAdvice).order_by(MemoryAdvice.at)).all()
    ]
    messages = [
        {
            "id": row.id,
            "role": row.role,
            "content": row.content,
            "at": ms(row.at),
            **({"source": row.source} if row.source else {}),
            **({"citations": row.citations} if row.citations else {}),
            **({"code": row.code} if row.code else {}),
        }
        for row in db.scalars(
            select(ChatMessage).order_by(ChatMessage.seq.desc()).limit(message_limit)
        ).all()
    ]
    messages.reverse()
    return {
        "schemaVersion": 1,
        "profile": profile,
        "summaries": summaries,
        "advice": advice,
        "messages": messages,
    }


def settings_payload(db: Session) -> dict:
    row = db.get(AISettings, 1)
    key = keyring_store.get_llm_key()
    return {
        "schemaVersion": 1,
        "endpoint": row.endpoint if row else "",
        "model": row.model if row else "",
        "enabled": bool(row.enabled) if row else False,
        "hasKey": bool(key),
        "keyHint": (row.key_hint if row else None) or "",
    }


def export_payload(db: Session) -> dict:
    state = state_payload(db)
    memory = memory_payload(db)
    safe_settings = {
        "endpoint": settings_payload(db)["endpoint"],
        "model": settings_payload(db)["model"],
        "enabled": settings_payload(db)["enabled"],
    }
    return {
        "schemaVersion": 1,
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "sessions": sessions_payload(db)["sessions"],
        "draft": {
            "schemaVersion": 1,
            "tier": state["tier"],
            "order": state["order"],
            "cursor": state["cursor"],
            "results": state["results"],
            "drafts": state["drafts"],
            "updatedAt": state["startedAt"],
        }
        if state["tier"]
        else None,
        "settings": safe_settings,
        "memory": {
            "schemaVersion": 1,
            "profile": memory["profile"],
            "summaries": memory["summaries"],
            "advice": memory["advice"],
            "messages": memory["messages"],
        },
        "app": state,
    }
