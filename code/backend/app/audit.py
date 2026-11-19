"""Best-effort audit rows. Never raise: an audit failure must not break a request.

Only ids, actions and outcomes are stored. No passwords, no tokens, no LLM key,
no prompt text — see docs/requirements/nonfunctional_spec.md（日志与隐私）。
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from .models import AuditLog
from .security import audit_detail


def record(
    db: Session,
    user_id: int | None,
    action: str,
    object_: str = "",
    result: str = "ok",
    **detail: object,
) -> None:
    try:
        db.add(
            AuditLog(
                user_id=user_id,
                action=action,
                object=object_ or None,
                result=result,
                detail=audit_detail(**detail) if detail else None,
            )
        )
        db.commit()
    except Exception:  # pragma: no cover - observability must never break the app
        db.rollback()
