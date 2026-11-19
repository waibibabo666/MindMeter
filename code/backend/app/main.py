"""FastAPI application for the hosted MindMeter web app.

The same origin serves the API and the static frontend, so the browser needs
no CORS and the session cookie stays first-party. Importing this module does
not connect to a database; ``MM_AUTO_MIGRATE=1`` (the default) runs
``alembic upgrade head`` once at startup so a fresh Render Postgres works
without extra dashboard steps — set it to ``0`` when the deploy platform runs
a dedicated pre-deploy migration command.
"""
from __future__ import annotations

import os
import threading
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .api import api_router
from .config import settings
from .logging_setup import setup_logging
from .rag import warmup
from .security import SecurityMiddleware

logger = setup_logging(settings.data_dir)

app = FastAPI(
    title="MindMeter Web API",
    version=settings.app_version,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
app.add_middleware(SecurityMiddleware)
app.include_router(api_router)


def _auto_migrate_enabled() -> bool:
    return str(os.environ.get("MM_AUTO_MIGRATE", "1")).strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def run_migrations() -> None:
    """Best-effort schema upgrade at boot. Never takes the app down."""
    try:
        from alembic import command
        from alembic.config import Config

        backend = Path(__file__).resolve().parents[2] / "backend"
        config = Config(str(backend / "alembic.ini"))
        config.set_main_option("script_location", str(backend / "alembic"))
        command.upgrade(config, "head")
        logger.info("migrations applied")
    except Exception as exc:  # pragma: no cover - deployment safety net
        logger.warning("auto-migration failed: %s", exc.__class__.__name__)


@app.on_event("startup")
def _on_startup() -> None:
    if settings.database_url and _auto_migrate_enabled():
        run_migrations()
    if settings.rag_mode.lower() != "keyword":
        threading.Thread(target=warmup, daemon=True).start()

    def _purge() -> None:
        try:
            from . import auth
            from .db import SessionLocal

            with SessionLocal() as db:
                removed = auth.purge_expired_sessions(db)
            if removed:
                logger.info("purged %s expired sessions", removed)
        except Exception:  # pragma: no cover
            pass

    threading.Thread(target=_purge, daemon=True).start()


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    # 204 不能带响应体：之前用 JSONResponse(content=None) 会发 "null"，
    # h11 会抛 Too much data for declared Content-Length。
    return Response(status_code=204)


frontend = Path(settings.frontend_dir).resolve()
if frontend.is_dir():
    app.mount("/", StaticFiles(directory=str(frontend), html=True), name="frontend")
else:

    @app.get("/", include_in_schema=False)
    def missing_frontend():
        return JSONResponse({"error": "frontend_not_found"}, status_code=503)
