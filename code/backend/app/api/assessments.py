from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .. import auth
from ..agent import answer
from ..analysis import retrieve_context
from ..db import get_db
from ..models import AIRun, Assessment, AssessmentScore, AssessmentTask, User
from ..scoring import DIMENSION_IDS, SCORING_VERSION, score_session
from ..serializers import (
    assessment_to_session,
    find_assessment,
    sessions_payload,
)
from ..timeutil import parse_dt
from ..trend import build_trend_payload

router = APIRouter()

MAX_SESSIONS_PER_USER = 50


def _clean_prep(value: object) -> dict:
    """白名单化临场状态：睡眠 0-12 小时、疲劳 1-5，其它一律丢弃。"""
    if not isinstance(value, dict):
        return {}
    out: dict = {}
    sleep = value.get("sleep")
    fatigue = value.get("fatigue")
    if isinstance(sleep, (int, float)) and 0 <= sleep <= 12:
        out["sleep"] = int(sleep)
    if isinstance(fatigue, int) and 1 <= fatigue <= 5:
        out["fatigue"] = fatigue
    return out


def _prep_note(value: object) -> str:
    """报告里确定性追加的临场状态行：不依赖模型是否提到。"""
    prep = _clean_prep(value)
    bits = []
    if prep.get("sleep") is not None:
        bits.append(f"睡眠 {prep['sleep']} 小时")
    if prep.get("fatigue") is not None:
        bits.append(f"疲劳 {prep['fatigue']}/5")
    if not bits:
        return ""
    return "本次临场状态：" + "、".join(bits) + "；仅用于判断结果可信度，不参与计分。"


def persist_session(db: Session, user_id: int, session: dict) -> dict:
    """为 ``user_id`` 保存一次已完成的测评并返回其载荷。

    客户端 id 只在账号内唯一：同一账号重复提交同一 id 是幂等的，
    其他账号提交同一 id 则只是一条新记录。
    """
    if not isinstance(session, dict):
        raise HTTPException(400, "invalid_session")
    assessment_id = str(session.get("id") or "")
    if not assessment_id:
        assessment_id = f"s_{int(datetime.now(timezone.utc).timestamp() * 1000)}"

    existing = find_assessment(db, user_id, assessment_id)
    if existing is not None:
        return {"session": assessment_to_session(db, existing), "idempotent": True}

    mode = str(session.get("mode") or session.get("tier") or "standard")
    if mode not in {"quick", "standard", "deep"}:
        mode = "standard"
    results = session.get("results") if isinstance(session.get("results"), dict) else {}
    # 分档题量决定完成率判定：必须把 mode 传给引擎，否则 nc/ir/ni 会被判成未完成。
    scored = score_session(results, mode)
    finished_at = parse_dt(session.get("finishedAt")) or datetime.now(timezone.utc)
    dims = session.get("dims") if isinstance(session.get("dims"), list) else list(results.keys())

    assessment = Assessment(
        user_id=user_id,
        id=assessment_id,
        mode=mode,
        status="completed",
        started_at=parse_dt(session.get("startedAt")),
        finished_at=finished_at,
        scoring_version=SCORING_VERSION,
        context=_clean_prep(session.get("prep")),
        dims=dims,
    )
    db.add(assessment)
    for position, (task_id, task_payload) in enumerate(results.items()):
        if not isinstance(task_payload, dict):
            continue
        db.add(
            AssessmentTask(
                user_id=user_id,
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
                user_id=user_id,
                assessment_id=assessment_id,
                dimension=dim,
                score=scored["scores"].get(dim),
                scoring_version=SCORING_VERSION,
            )
        )
    db.flush()

    # 保持前端「每账号最多 50 次测评」的契约。
    old_ids = list(
        db.scalars(
            select(Assessment.id)
            .where(Assessment.user_id == user_id, Assessment.status == "completed")
            .order_by(Assessment.finished_at.desc().nullslast())
            .offset(MAX_SESSIONS_PER_USER)
        ).all()
    )
    if old_ids:
        db.execute(
            delete(Assessment).where(
                Assessment.user_id == user_id, Assessment.id.in_(old_ids)
            )
        )
    db.commit()
    return {"session": assessment_to_session(db, assessment), "idempotent": False}


@router.post("/assessments")
def create_assessment(
    payload: dict = Body(...),
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
):
    session = payload.get("session") if isinstance(payload.get("session"), dict) else payload
    return persist_session(db, int(user.id), session)


@router.get("/assessments")
def list_assessments(
    limit: int = 50,
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
):
    return sessions_payload(db, int(user.id), limit=max(1, min(limit, MAX_SESSIONS_PER_USER)))


@router.get("/assessments/{assessment_id}")
def get_assessment(
    assessment_id: str,
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
):
    row = find_assessment(db, int(user.id), assessment_id)
    if row is None:
        raise HTTPException(404, "assessment_not_found")
    return assessment_to_session(db, row)


@router.get("/trends")
def trends(user: User = Depends(auth.require_user), db: Session = Depends(get_db)):
    sessions = sessions_payload(db, int(user.id), limit=2)["sessions"]
    payload = build_trend_payload(sessions)
    if payload is None:
        return {"rows": [], "onlyPrev": [], "onlyNext": [], "days": None, "sessions": sessions}
    return {**payload, "sessions": sessions}


@router.get("/reports/{assessment_id}")
def report(
    assessment_id: str,
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
):
    row = find_assessment(db, int(user.id), assessment_id)
    if row is None:
        raise HTTPException(404, "assessment_not_found")
    return assessment_to_session(db, row)


REPORT_EXPLAIN_QUESTION = "请用两到三句平实的话，解释这些原始指标各自测量了什么、这组数字怎么读。"


@router.post("/reports/{assessment_id}/explain")
def explain_report(
    assessment_id: str,
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
):
    """报告解读卡：与对话共用同一张图、同一套校验与兜底（P0 统一出口）。"""
    row = find_assessment(db, int(user.id), assessment_id)
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
    prep = session.get("prep")
    if isinstance(prep, dict) and prep:
        facts["prep"] = prep
    chunks = retrieve_context(db, facts)
    result = answer(db, REPORT_EXPLAIN_QUESTION, facts, [], None, scene="report", chunks=chunks)
    code = result.get("code")
    code = None if code in (None, "ok") else str(code)
    db.add(
        AIRun(
            user_id=int(user.id),
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
    text = result.get("displayText") or result.get("text", "")
    prep_line = _prep_note(session.get("prep"))
    if prep_line and "本次临场状态" not in text:
        text = f"{text}\n\n{prep_line}"
    return {
        "text": text,
        "source": result.get("source", "template"),
        # code 现在是真实原因（模型侧 timeout/auth/…，或校验侧 too_long/banned_word/
        # unsourced_number/score_misattributed）；细到"哪几个数字没有出处"看 validation。
        "code": code,
        "reason": code or "",
        "validation": result.get("validation") or [],
        "citations": [item["id"] for item in (result.get("shownSources") or []) if item.get("id")],
        "sources": result.get("shownSources") or [],
    }
