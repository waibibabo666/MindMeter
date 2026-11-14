from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .. import keyring_store
from ..agent import template_explanation
from ..db import get_db
from ..llm import LLMError, call_llm, is_configured
from ..models import (
    AIRun,
    AISettings,
    Assessment,
    AssessmentScore,
    AssessmentTask,
)
from ..scoring import DIMENSION_IDS, SCORING_VERSION, score_session
from ..serializers import assessment_to_session, sessions_payload
from ..timeutil import parse_dt

router = APIRouter()


def _facts(session: dict) -> dict:
    facts = {}
    for dim, payload in (session.get("results") or {}).items():
        if isinstance(payload, dict) and isinstance(payload.get("metrics"), dict):
            facts[dim] = dict(payload["metrics"])
            score = (session.get("scores") or {}).get(dim)
            if isinstance(score, int):
                facts[dim]["score"] = score
    return facts


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
    if len(sessions) < 2:
        return {"rows": [], "onlyPrev": [], "onlyNext": [], "days": None, "sessions": sessions}
    prev, nxt = sessions[1], sessions[0]
    common = [
        dim
        for dim in DIMENSION_IDS
        if isinstance((prev.get("scores") or {}).get(dim), int)
        and isinstance((nxt.get("scores") or {}).get(dim), int)
    ]
    rows = [
        {
            "id": dim,
            "prev": prev["scores"][dim],
            "next": nxt["scores"][dim],
            "delta": nxt["scores"][dim] - prev["scores"][dim],
        }
        for dim in common
    ]
    prev_at = parse_dt(prev.get("finishedAt"))
    next_at = parse_dt(nxt.get("finishedAt"))
    days = None
    if prev_at and next_at:
        days = int(abs((next_at - prev_at).total_seconds()) // 86400)
    return {
        "rows": rows,
        "onlyPrev": [d for d in DIMENSION_IDS if isinstance((prev.get("scores") or {}).get(d), int) and d not in common],
        "onlyNext": [d for d in DIMENSION_IDS if isinstance((nxt.get("scores") or {}).get(d), int) and d not in common],
        "days": days,
        "sessions": sessions,
    }


@router.get("/reports/{assessment_id}")
def report(assessment_id: str, db: Session = Depends(get_db)):
    row = db.get(Assessment, assessment_id)
    if row is None:
        raise HTTPException(404, "assessment_not_found")
    return assessment_to_session(db, row)


def _explain_messages(metrics: dict) -> list[dict]:
    facts = "\n".join(f"{key}: {value}" for key, value in metrics.items())
    return [
        {
            "role": "system",
            "content": (
                "你是 MindMeter 的解读助手。只解释给出的原始指标，不推断能力高低，不下诊断，"
                "不与人群比较，不提“总分”“百分位”。语气平实，不超过 120 字。"
            ),
        },
        {
            "role": "user",
            "content": f"原始指标：\n{facts or '（无）'}\n请用两句话解释这些指标的含义。",
        },
    ]


@router.post("/reports/{assessment_id}/explain")
def explain_report(assessment_id: str, db: Session = Depends(get_db)):
    row = db.get(Assessment, assessment_id)
    if row is None:
        raise HTTPException(404, "assessment_not_found")
    session = assessment_to_session(db, row)
    metrics = {dim: value.get("metrics", {}) for dim, value in session["results"].items()}
    settings_row = db.get(AISettings, 1)
    key = keyring_store.get_llm_key()
    if settings_row is None or not is_configured(
        settings_row.endpoint, settings_row.model, key, settings_row.enabled
    ):
        return {
            "text": template_explanation(metrics),
            "source": "template",
            "code": "not_configured",
            "reason": "未配置 AI，用模板解读",
        }
    started = datetime.now(timezone.utc)
    try:
        reply = call_llm(
            endpoint=settings_row.endpoint,
            model=settings_row.model,
            key=key or "",
            messages=_explain_messages(metrics),
            max_tokens=300,
        )
        db.add(
            AIRun(
                assessment_id=assessment_id,
                model=reply.model,
                intent="explain_report",
                latency_ms=int((datetime.now(timezone.utc) - started).total_seconds() * 1000),
                degraded=False,
                error_code=None,
            )
        )
        db.commit()
        return {"text": reply.text, "source": "llm", "code": None, "reason": ""}
    except LLMError as exc:
        db.add(
            AIRun(
                assessment_id=assessment_id,
                model=settings_row.model,
                intent="explain_report",
                latency_ms=int((datetime.now(timezone.utc) - started).total_seconds() * 1000),
                degraded=True,
                error_code=exc.code,
            )
        )
        db.commit()
        return {
            "text": template_explanation(metrics),
            "source": "template",
            "code": exc.code,
            "reason": exc.code,
        }
