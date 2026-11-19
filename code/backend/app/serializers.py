"""Convert database rows to the JSON shapes the frontend already speaks.

Every function takes ``user_id`` and filters by it — that is the whole tenancy
story. Keeping these shapes stable lets the frozen pages keep their rendering
code (docs/adr/0001, docs/adr/0003).
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from .llm import site_llm_config
from .models import (
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


# ---------------------------------------------------------------------------
# Row lookup: composite (user_id, id) primary keys
# ---------------------------------------------------------------------------


def get_state_row(db: Session, user_id: int, create: bool = False) -> AppState | None:
    row = db.get(AppState, user_id)
    if row is None and create:
        row = AppState(user_id=user_id)
        db.add(row)
    return row


def find_assessment(db: Session, user_id: int, assessment_id: str) -> Assessment | None:
    return db.get(Assessment, (user_id, assessment_id))


def find_summary(db: Session, user_id: int, summary_id: str) -> MemorySummary | None:
    return db.get(MemorySummary, (user_id, summary_id))


def find_advice(db: Session, user_id: int, advice_id: str) -> MemoryAdvice | None:
    return db.get(MemoryAdvice, (user_id, advice_id))


def find_message(db: Session, user_id: int, message_id: str) -> ChatMessage | None:
    return db.get(ChatMessage, (user_id, message_id))


# ---------------------------------------------------------------------------
# Payloads
# ---------------------------------------------------------------------------


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


def state_payload(db: Session, user_id: int) -> dict:
    row = db.get(AppState, user_id)
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
            .where(
                AssessmentTask.user_id == assessment.user_id,
                AssessmentTask.assessment_id == assessment.id,
            )
            .order_by(AssessmentTask.position)
        ).all()
    )
    results = {
        task.task_id: {"metrics": task.metrics or {}, "answers": task.answers or []}
        for task in tasks
    }
    score_rows = list(
        db.scalars(
            select(AssessmentScore).where(
                AssessmentScore.user_id == assessment.user_id,
                AssessmentScore.assessment_id == assessment.id,
            )
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


def sessions_payload(db: Session, user_id: int, limit: int = 50) -> dict:
    rows = list(
        db.scalars(
            select(Assessment)
            .where(Assessment.user_id == user_id, Assessment.status == "completed")
            .order_by(Assessment.finished_at.desc().nullslast())
            .limit(limit)
        ).all()
    )
    return {"schemaVersion": 1, "sessions": [assessment_to_session(db, row) for row in rows]}


def memory_payload(db: Session, user_id: int, message_limit: int = 20) -> dict:
    profile_row = db.get(MemoryProfile, user_id)
    profile: dict[str, object] = {}
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
        for row in db.scalars(
            select(MemorySummary)
            .where(MemorySummary.user_id == user_id)
            .order_by(MemorySummary.at)
        ).all()
    ]
    advice = [
        {
            "id": row.id,
            "at": ms(row.at),
            "title": row.title,
            "shown": bool(row.shown),
            "done": bool(row.done),
        }
        for row in db.scalars(
            select(MemoryAdvice).where(MemoryAdvice.user_id == user_id).order_by(MemoryAdvice.at)
        ).all()
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
            **({"risk": row.risk} if row.risk else {}),
        }
        for row in db.scalars(
            select(ChatMessage)
            .where(ChatMessage.user_id == user_id)
            .order_by(ChatMessage.seq.desc())
            .limit(message_limit)
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


def settings_payload(db: Session | None = None) -> dict:
    """Site-provided AI: the browser sees the model name, never the key."""
    config = site_llm_config()
    payload = config.public()
    payload["schemaVersion"] = 1
    return payload


def export_payload(db: Session, user_id: int) -> dict:
    state = state_payload(db, user_id)
    memory = memory_payload(db, user_id)
    safe_settings = site_llm_config().public()
    return {
        "schemaVersion": 1,
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "sessions": sessions_payload(db, user_id)["sessions"],
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
        "settings": {
            "endpoint": safe_settings["endpoint"],
            "model": safe_settings["model"],
            "enabled": safe_settings["enabled"],
        },
        "memory": {
            "schemaVersion": 1,
            "profile": memory["profile"],
            "summaries": memory["summaries"],
            "advice": memory["advice"],
            "messages": memory["messages"],
        },
        "app": state,
    }
