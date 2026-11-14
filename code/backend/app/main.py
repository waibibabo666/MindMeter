"""FastAPI application for the local desktop app.

Important: importing this module never starts PostgreSQL and never runs
migrations. The desktop launcher owns both.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .api import api_router
from .config import settings
from .logging_setup import setup_logging
from .security import enforce_local_request

setup_logging(settings.data_dir)

app = FastAPI(
    title="MindMeter Local API",
    version=settings.app_version,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
app.middleware("http")(enforce_local_request)
app.include_router(api_router)


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return JSONResponse(status_code=204, content=None)


frontend = Path(settings.frontend_dir).resolve()
if frontend.is_dir():
    app.mount("/", StaticFiles(directory=str(frontend), html=True), name="frontend")
else:

    @app.get("/", include_in_schema=False)
    def missing_frontend():
        return JSONResponse({"error": "frontend_not_found"}, status_code=503)
