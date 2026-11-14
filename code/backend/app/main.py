"""FastAPI application for the local desktop app.

Important: importing this module never starts PostgreSQL and never runs
migrations. The desktop launcher owns both.
"""
from __future__ import annotations

import threading
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from .api import api_router
from .config import settings
from .logging_setup import setup_logging
from .rag import warmup
from .security import LocalGuardMiddleware

setup_logging(settings.data_dir)

app = FastAPI(
    title="MindMeter Local API",
    version=settings.app_version,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
app.add_middleware(LocalGuardMiddleware)
app.include_router(api_router)


@app.on_event("startup")
def _warm_embedding_model() -> None:
    """Load the optional local model off the request path (never starts DB)."""
    if settings.rag_mode.lower() != "keyword":
        threading.Thread(target=warmup, daemon=True).start()


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
