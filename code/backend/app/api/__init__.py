from __future__ import annotations

from fastapi import APIRouter

from . import assessments, chat, data, health, memory, settings as settings_api, state

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health.router, tags=["health"])
api_router.include_router(state.router, tags=["state"])
api_router.include_router(assessments.router, tags=["assessments"])
api_router.include_router(memory.router, tags=["memory"])
api_router.include_router(chat.router, tags=["chat"])
api_router.include_router(settings_api.router, tags=["settings"])
api_router.include_router(data.router, tags=["data"])
