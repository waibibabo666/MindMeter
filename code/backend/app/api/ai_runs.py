"""AI 运行看板：只读最近若干次调用的延迟与降级情况。

用途：答辩/自检时能看到"模型到底有没有在工作、慢在哪、有多少次回退模板"。
不返回用户内容，只返回指标。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import auth
from ..db import get_db
from ..models import AIRun, User

router = APIRouter()


@router.get("/ai/runs")
def recent_runs(
    limit: int = Query(default=20, ge=1, le=50),
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
):
    base = select(AIRun).where(AIRun.user_id == user.id)
    rows = db.execute(base.order_by(AIRun.created_at.desc()).limit(limit)).scalars().all()
    total = db.scalar(
        select(func.count()).select_from(AIRun).where(AIRun.user_id == user.id)
    ) or 0
    degraded = db.scalar(
        select(func.count())
        .select_from(AIRun)
        .where(AIRun.user_id == user.id, AIRun.degraded.is_(True))
    ) or 0
    latencies = sorted(row.latency_ms for row in rows if row.latency_ms is not None)
    p95 = latencies[max(0, int(len(latencies) * 0.95) - 1)] if latencies else None
    return {
        "total": int(total),
        "degraded": int(degraded),
        "degradedRate": round(degraded / total, 3) if total else 0.0,
        "avgLatencyMs": round(sum(latencies) / len(latencies)) if latencies else None,
        "p95LatencyMs": p95,
        "recent": [
            {
                "at": row.created_at.isoformat() if row.created_at else None,
                "model": row.model,
                "intent": row.intent,
                "latencyMs": row.latency_ms,
                "degraded": bool(row.degraded),
                "errorCode": row.error_code,
            }
            for row in rows
        ],
    }
