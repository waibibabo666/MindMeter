from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..agent import answer
from ..analysis import retrieve_context
from ..db import get_db
from ..models import (
    AIRun,
    Assessment,
    AssessmentScore,
    AssessmentTask,
)
from ..scoring import DIMENSION_IDS, SCORING_VERSION, score_session
from ..serializers import assessment_to_session, sessions_payload
from ..timeutil import parse_dt
from ..trend import build_trend_payload

router = APIRouter()


@router.post("/assessments")
def create_assessment(payload: dict = Body(...), db: Session = Depends(get_db)):
    session = payload.get("session") if isinstance(payload.get("session"), dict) else payload
    if not isinstance(session, dict):
        raise HTTPException(400, "invalid_session")
    assessment_id = str(session.get("id") or "")
    if not assessment_id:
        assessment_id = f"s_{int(datetime.now(timezone.utc).timestamp() * 1000)}"

    mode = str(session.get("mode") or session.get("tier") or "standard")
    if mode not in {"quick", "standard", "deep"}:
        mode = "standard"
    results = session.get("results") if isinstance(session.get("results"), dict) else {}
    scored = score_session(results)
    finished_at = parse_dt(session.get("finishedAt")) or datetime.now(timezone.utc)
    dims = session.get("dims") if isinstance(session.get("dims"), list) else list(results.keys())

    existing = db.get(Assessment, assessment_id)
    if existing is not None:
        return {"session": assessment_to_session(db, existing), "idempotent": True}

    assessment = Assessment(
        id=assessment_id,
        mode=mode,
        status="completed",
        started_at=parse_dt(session.get("startedAt")),
        finished_at=finished_at,
        scoring_version=SCORING_VERSION,
        dims=dims,
    )
    db.add(assessment)
    for position, (task_id, task_payload) in enumerate(results.items()):
        if not isinstance(task_payload, dict):
            continue
        db.add(
            AssessmentTask(
                assessment_id=assessment_id,
                task_id=task_id,
                position=position,
                metrics=task_payload.get("metrics") or {},
                answers=task_payload.get("answers") or [],
            )
        )
    for dim in DIMENSION_IDS:
        db.add(
            AssessmentScore(
                assessment_id=assessment_id,
                dimension=dim,
                score=scored["scores"].get(dim),
                scoring_version=SCORING_VERSION,
            )
        )
    db.flush()

    # Preserve the UI's max-50 sessions contract.
    old_ids = list(
        db.scalars(
            select(Assessment.id)
            .where(Assessment.status == "completed")
            .order_by(Assessment.finished_at.desc().nullslast())
            .offset(50)
        ).all()
    )
    if old_ids:
        db.execute(delete(Assessment).where(Assessment.id.in_(old_ids)))
    db.commit()
    return {"session": assessment_to_session(db, assessment), "idempotent": False}


@router.get("/assessments")
def list_assessments(limit: int = 50, db: Session = Depends(get_db)):
    return sessions_payload(db, limit=max(1, min(limit, 50)))


@router.get("/assessments/{assessment_id}")
def get_assessment(assessment_id: str, db: Session = Depends(get_db)):
    row = db.get(Assessment, assessment_id)
    if row is None:
        raise HTTPException(404, "assessment_not_found")
    return assessment_to_session(db, row)


@router.get("/trends")
def trends(db: Session = Depends(get_db)):
    sessions = sessions_payload(db, limit=2)["sessions"]
    payload = build_trend_payload(sessions)
    if payload is None:
        return {"rows": [], "onlyPrev": [], "onlyNext": [], "days": None, "sessions": sessions}
    return {**payload, "sessions": sessions}


@router.get("/reports/{assessment_id}")
def report(assessment_id: str, db: Session = Depends(get_db)):
    row = db.get(Assessment, assessment_id)
    if row is None:
        raise HTTPException(404, "assessment_not_found")
    return assessment_to_session(db, row)


REPORT_EXPLAIN_QUESTION = "请用两到三句平实的话，解释这些原始指标各自测量了什么、这组数字怎么读。"


@router.post("/reports/{assessment_id}/explain")
def explain_report(assessment_id: str, db: Session = Depends(get_db)):
    """报告解读卡：与对话共用同一张图、同一套校验与兜底（P0 统一出口）。"""
    row = db.get(Assessment, assessment_id)
    if row is None:
        raise HTTPException(404, "assessment_not_found")
    session = assessment_to_session(db, row)
    facts = {
        dim: (payload.get("metrics") or {})
        for dim, payload in (session.get("results") or {}).items()
        if isinstance(payload, dict)
    }
    for dim in list(facts):
        score = (session.get("scores") or {}).get(dim)
        if isinstance(score, int):
            facts[dim]["score"] = score
    chunks = retrieve_context(db, facts)
    result = answer(db, REPORT_EXPLAIN_QUESTION, facts, [], None, scene="report", chunks=chunks)
    code = result.get("code")
    code = None if code in (None, "ok") else str(code)
    db.add(
        AIRun(
            assessment_id=assessment_id,
            model=result.get("model"),
            intent="explain_report",
            latency_ms=result.get("latency_ms"),
            degraded=result.get("source") != "llm",
            error_code=code,
            validation=result.get("validation") or None,
        )
    )
    db.commit()
    return {
        "text": result.get("text", ""),
        "source": result.get("source", "template"),
        "code": code,
        "reason": code or "",
        "citations": result.get("citations") or [],
        "sources": result.get("sources") or [],
    }
