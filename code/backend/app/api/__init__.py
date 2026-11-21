from __future__ import annotations

from fastapi import APIRouter

from . import (
    ai_runs,
    assessments,
    auth,
    chat,
    data,
    games,
    health,
    memory,
)
from . import settings as settings_api
from . import state

# v1 is the stable surface the frontend speaks (docs/requirements/functional_spec.md §API).
api_router = APIRouter(prefix="/api/v1")

# Public: the readiness probe and the account endpoints that establish a session.
api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router, tags=["auth"])

# Authenticated: every one of these reads and writes rows scoped to the session user.
api_router.include_router(state.router, tags=["state"])
api_router.include_router(assessments.router, tags=["assessments"])
api_router.include_router(games.router, tags=["games"])
api_router.include_router(memory.router, tags=["memory"])
api_router.include_router(chat.router, tags=["chat"])
api_router.include_router(settings_api.router, tags=["settings"])
api_router.include_router(data.router, tags=["data"])
api_router.include_router(ai_runs.router, tags=["ai"])
