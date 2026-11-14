from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import AppState
from ..serializers import state_payload

router = APIRouter()


def _dt(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000.0, tz=timezone.utc)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


@router.get("/state")
def get_state(db: Session = Depends(get_db)):
    return state_payload(db)


@router.put("/state")
def put_state(payload: dict = Body(...), db: Session = Depends(get_db)):
    row = db.get(AppState, 1) or AppState(id=1)
    row.route = str(payload.get("route") or "/")
    row.tier = payload.get("tier")
    row.consented = bool(payload.get("consented"))
    row.consented_age = bool(payload.get("consentedAge"))
    row.started_at = _dt(payload.get("startedAt"))
    row.task_order = list(payload.get("order") or [])
    row.cursor = int(payload.get("cursor") or 0)
    row.results = payload.get("results") if isinstance(payload.get("results"), dict) else {}
    row.drafts = payload.get("drafts") if isinstance(payload.get("drafts"), dict) else {}
    db.add(row)
    db.commit()
    return state_payload(db)
