from __future__ import annotations

import time

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..llm import site_llm_config
from ..rag import rag_status

router = APIRouter()


@router.get("/health/live")
def live():
    """仅存活检查：不碰数据库、不碰模型。平台健康检查应指向这里，
    这样 Postgres 冷重启不会让服务看起来已死。"""
    return {"status": "alive", "version": settings.app_version}


@router.get("/health")
def health(db: Session = Depends(get_db)):
    """公开就绪探针：平台健康检查路径指向这里。

    Reports structure, never user data and never the LLM key.
    """
    started = time.perf_counter()
    try:
        db.execute(text("SELECT 1"))
        migration = db.execute(text("SELECT version_num FROM alembic_version LIMIT 1")).scalar()
        vector = db.execute(
            text("SELECT extversion FROM pg_extension WHERE extname = 'vector'")
        ).scalar()
        latency = round((time.perf_counter() - started) * 1000, 1)
        accounts = db.scalar(text("SELECT count(*) FROM users")) or 0
        try:
            rag = rag_status(db)
        except Exception:
            rag = {"chunks": 0, "embedded": 0, "mode": "unavailable", "model": ""}
        config = site_llm_config()
        return {
            "status": "ok",
            "version": settings.app_version,
            "db": {
                "connected": True,
                "latency_ms": latency,
                "migration": migration,
                "pgvector": vector,
            },
            "rag": rag,
            "ai": {"enabled": config.enabled, "model": config.model},
            "users": int(accounts),
        }
    except Exception:
        return JSONResponse(
            {"status": "degraded", "version": settings.app_version, "db": {"connected": False}},
            status_code=503,
        )
