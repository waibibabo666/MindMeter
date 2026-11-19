from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import JSONResponse

from .. import auth
from ..config import settings
from ..llm import LLMError, call_llm, site_llm_config
from ..models import User
from ..serializers import settings_payload

router = APIRouter()

MANAGED = "ai_managed_by_site"


@router.get("/settings/ai")
def get_settings(user: User = Depends(auth.require_user)):
    """Read-only view of the site-provided model. The key never appears here."""
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
    """One-token round trip against the deployment's own credentials."""
    config = site_llm_config()
    if not config.enabled:
        return JSONResponse({"ok": False, "code": "not_configured"}, status_code=400)
    try:
        reply = call_llm(
            endpoint=config.endpoint,
            model=config.model,
            key=config.key,
            messages=[{"role": "user", "content": "只回复 OK"}],
            max_tokens=8,
            timeout_s=min(settings.llm_timeout_s, 20.0),
        )
        return {"ok": True, "code": "ok", "model": reply.model}
    except LLMError as exc:
        return JSONResponse({"ok": False, "code": exc.code}, status_code=400)
