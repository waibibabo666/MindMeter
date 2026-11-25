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

# v1 是前端使用的稳定接口面（docs/requirements/functional_spec.md §API）。
api_router = APIRouter(prefix="/api/v1")

# 公开：就绪探针与会话建立类账号接口。
api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router, tags=["auth"])

# 需登录：以下接口读写的行都限定在当前会话用户。
api_router.include_router(state.router, tags=["state"])
api_router.include_router(assessments.router, tags=["assessments"])
api_router.include_router(games.router, tags=["games"])
api_router.include_router(memory.router, tags=["memory"])
api_router.include_router(chat.router, tags=["chat"])
api_router.include_router(settings_api.router, tags=["settings"])
api_router.include_router(data.router, tags=["data"])
api_router.include_router(ai_runs.router, tags=["ai"])
