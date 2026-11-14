from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from .. import keyring_store
from ..db import get_db
from ..llm import LLMError, call_llm, is_configured
from ..models import AISettings
from ..serializers import settings_payload

router = APIRouter()


@router.get("/settings/ai")
def get_settings(db: Session = Depends(get_db)):
    try:
        return settings_payload(db)
    except keyring_store.KeyStoreError:
        return JSONResponse({"error": "keyring_unavailable"}, status_code=503)


@router.put("/settings/ai")
def put_settings(payload: dict = Body(...), db: Session = Depends(get_db)):
    row = db.get(AISettings, 1) or AISettings(id=1)
    row.endpoint = str(payload.get("endpoint") or "").strip()
    row.model = str(payload.get("model") or "").strip()
    row.enabled = bool(payload.get("enabled"))
    api_key = str(payload.get("apiKey") or payload.get("api_key") or "").strip()
    try:
        if api_key:
            keyring_store.set_llm_key(api_key)
            row.key_ref = f"keyring:{keyring_store.SERVICE}/{keyring_store.LLM_USER}"
            row.key_hint = keyring_store.mask_key(api_key)
        row.updated_at = datetime.now(timezone.utc)
        db.add(row)
        db.commit()
        return settings_payload(db)
    except keyring_store.KeyStoreError:
        return JSONResponse({"error": "keyring_unavailable"}, status_code=503)


@router.delete("/settings/ai/key")
def delete_key(db: Session = Depends(get_db)):
    try:
        keyring_store.delete_llm_key()
    except keyring_store.KeyStoreError:
        return JSONResponse({"error": "keyring_unavailable"}, status_code=503)
    row = db.get(AISettings, 1)
    if row is not None:
        row.key_ref = None
        row.key_hint = None
        row.enabled = False
        db.commit()
    return {"ok": True}


@router.post("/settings/ai/test")
def test_connection(db: Session = Depends(get_db)):
    row = db.get(AISettings, 1)
    try:
        key = keyring_store.get_llm_key()
    except keyring_store.KeyStoreError:
        return JSONResponse({"error": "keyring_unavailable"}, status_code=503)
    if row is None or not is_configured(row.endpoint, row.model, key, True):
        return JSONResponse({"ok": False, "code": "not_configured"}, status_code=400)
    try:
        reply = call_llm(
            endpoint=row.endpoint,
            model=row.model,
            key=key or "",
            messages=[{"role": "user", "content": "只回复 OK"}],
            max_tokens=8,
            timeout_s=15,
        )
        return {"ok": True, "code": "ok", "model": reply.model}
    except LLMError as exc:
        return JSONResponse({"ok": False, "code": exc.code, "message": exc.code}, status_code=400)
