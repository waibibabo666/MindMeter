from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import JSONResponse

from .. import auth
from ..config import settings
from ..llm import LLMError, call_llm_with_fallback, site_llm_config
from ..models import User
from ..serializers import settings_payload

router = APIRouter()

MANAGED = "ai_managed_by_site"


@router.get("/settings/ai")
def get_settings(user: User = Depends(auth.require_user)):
    """站点级模型的只读视图；Key 永远不会出现在这里。"""
    return settings_payload()


@router.put("/settings/ai")
def put_settings(
    payload: dict = Body(...), user: User = Depends(auth.require_user)  # noqa: ARG001
):
    raise HTTPException(403, detail=MANAGED)


@router.delete("/settings/ai/key")
def delete_key(user: User = Depends(auth.require_user)):
    raise HTTPException(403, detail=MANAGED)


@router.post("/settings/ai/test")
def test_connection(user: User = Depends(auth.require_user)):
    """One-token round trip against the deployment's own credentials.

    走的是与真实对话同一条链路（含退避重试与备用模型），所以这里成功就意味着
    对话也会成功；返回实际应答的模型名，便于确认备用链是否在工作。
    """
    config = site_llm_config()
    if not config.enabled:
        return JSONResponse({"ok": False, "code": "not_configured"}, status_code=400)
    try:
        reply = call_llm_with_fallback(
            config,
            [{"role": "user", "content": "只回复 OK"}],
            max_tokens=8,
            timeout_s=min(settings.llm_timeout_s, 20.0),
        )
        return {"ok": True, "code": "ok", "model": reply.model, "requested": config.model}
    except LLMError as exc:
        return JSONResponse(
            {"ok": False, "code": exc.code, "tried": config.chain()},
            status_code=400,
        )
