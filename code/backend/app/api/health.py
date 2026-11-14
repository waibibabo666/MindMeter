from __future__ import annotations

import time

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..rag import rag_status

router = APIRouter()


@router.get("/health")
def health(db: Session = Depends(get_db)):
    started = time.perf_counter()
    try:
        db.execute(text("SELECT 1"))
        migration = db.execute(text("SELECT version_num FROM alembic_version LIMIT 1")).scalar()
        vector = db.execute(
            text("SELECT extversion FROM pg_extension WHERE extname = 'vector'")
        ).scalar()
        latency = round((time.perf_counter() - started) * 1000, 1)
        try:
            rag = rag_status(db)
        except Exception:
            rag = {"chunks": 0, "embedded": 0, "mode": "unavailable", "model": ""}
        return {
            "status": "ok",
            "version": settings.app_version,
            "db": {
                "connected": True,
                "latency_ms": latency,
                "database": settings.pg_database,
                "migration": migration,
                "pgvector": vector,
            },
            "rag": rag,
        }
    except Exception:
        return JSONResponse(
            {
                "status": "degraded",
                "version": settings.app_version,
                "db": {"connected": False},
            },
            status_code=503,
        )
