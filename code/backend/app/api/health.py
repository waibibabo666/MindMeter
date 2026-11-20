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
    """Liveness only: no database, no model. A platform health check belongs here
    so a cold Postgres restart does not make the service look dead."""
    return {"status": "alive", "version": settings.app_version}


@router.get("/health")
def health(db: Session = Depends(get_db)):
    """Public readiness probe: the platform health check path points here.

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
