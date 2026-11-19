"""Account endpoints: register, login, logout, password, erasure.

Everything here except register/login/session is authenticated. Responses use
the same ``{error|detail}`` JSON shape as the rest of the API so the frontend
can map failures without a second code path.
"""
from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from .. import auth
from ..db import get_db
from ..audit import record
from ..config import settings
from ..models import User

router = APIRouter()


def _payload_user(payload: dict) -> tuple[str, str]:
    username = auth.normalize_username(payload.get("username"))
    password = str(payload.get("password") or "")
    return username, password


def _user_json(user: User) -> dict:
    return {
        "username": user.username,
        "createdAt": user.created_at.isoformat() if user.created_at else None,
        "lastLoginAt": user.last_login_at.isoformat() if user.last_login_at else None,
    }


@router.get("/auth/session")
def session_state(request: Request, db: Session = Depends(get_db)):
    """Public boot probe: is this browser signed in, and as who?"""
    pair = auth.read_session(db, request)
    if pair is None:
        return {
            "authenticated": False,
            "user": None,
            "registrationOpen": settings.allow_registration,
            "appVersion": settings.app_version,
        }
    user, _session = pair
    return {
        "authenticated": True,
        "user": _user_json(user),
        "registrationOpen": settings.allow_registration,
        "appVersion": settings.app_version,
    }


@router.post("/auth/register")
def register(
    request: Request,
    response: Response,
    payload: dict = Body(...),
    db: Session = Depends(get_db),
):
    if not settings.allow_registration:
        raise HTTPException(403, detail="registration_disabled")
    key = f"register:{auth.client_ip_of(request)}"
    if auth.throttle_hit(key, settings.register_window_s, settings.register_max_attempts):
        raise HTTPException(429, detail="too_many_registrations")
    if not payload.get("adult"):
        # F-01: registration requires the 18+ confirmation.
        raise HTTPException(400, detail="adult_confirmation_required")

    username, password = _payload_user(payload)
    problems = auth.credential_errors(username, password, str(payload.get("confirm") or ""))
    if problems:
        raise HTTPException(400, detail=";".join(problems))
    if auth.get_user(db, username) is not None:
        raise HTTPException(409, detail="username_taken")

    user = auth.create_user(db, username, password)
    token = auth.issue_session(db, user, request)
    auth.apply_session_cookie(response, token, auth.wants_secure_cookie(request))
    record(db, user.id, "register", "users", "ok")
    return {"authenticated": True, "user": _user_json(user), "created": True}


@router.post("/auth/login")
def login(
    request: Request,
    response: Response,
    payload: dict = Body(...),
    db: Session = Depends(get_db),
):
    username, password = _payload_user(payload)
    throttle_key = auth.login_throttle_key(request, username)
    if auth.throttle_hit(throttle_key, settings.login_window_s, settings.login_max_attempts):
        raise HTTPException(429, detail="too_many_login_attempts")
    if not username or not password:
        raise HTTPException(400, detail="username_and_password_required")

    try:
        user = auth.check_login(db, username, password)
    except HTTPException:
        record(db, None, "login", "users", "failed", username=username)
        raise HTTPException(401, detail="invalid_credentials") from None

    auth.throttle_reset(throttle_key)
    token = auth.issue_session(db, user, request)
    auth.apply_session_cookie(response, token, auth.wants_secure_cookie(request))
    record(db, user.id, "login", "users", "ok")
    return {"authenticated": True, "user": _user_json(user)}


@router.post("/auth/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    pair = auth.read_session(db, request)
    auth.revoke(db, request)
    auth.clear_session_cookie(response)
    if pair is not None:
        record(db, pair[0].id, "logout", "users", "ok")
    return {"authenticated": False}


@router.get("/auth/me")
def me(user: User = Depends(auth.require_user)):
    return {"authenticated": True, "user": _user_json(user)}


@router.post("/auth/password")
def change_password(
    request: Request,
    response: Response,
    payload: dict = Body(...),
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
):
    current = str(payload.get("currentPassword") or payload.get("old") or "")
    new = str(payload.get("newPassword") or payload.get("password") or "")
    if payload.get("confirm") not in (None, "") and payload["confirm"] != new:
        raise HTTPException(400, detail="两次输入的密码不一致")
    auth.change_password(db, user, current, new)
    # The old session was just revoked: issue a fresh cookie for this browser.
    token = auth.issue_session(db, user, request)
    auth.apply_session_cookie(response, token, auth.wants_secure_cookie(request))
    record(db, user.id, "change_password", "users", "ok")
    return {"ok": True, "revokedOtherSessions": True}


@router.delete("/auth/account")
def delete_account(
    request: Request,
    response: Response,
    payload: dict = Body(...),
    user: User = Depends(auth.require_user),
    db: Session = Depends(get_db),
):
    """F-05: 注销账号。Hard delete; ON DELETE CASCADE clears every row."""
    password = str(payload.get("password") or "")
    if not auth.verify_password(password, user.password_hash):
        raise HTTPException(403, detail="wrong_password")
    auth.delete_account(db, user)
    # The account row is gone, so this audit row carries no user id at all.
    record(db, None, "delete_account", "users", "ok")
    auth.clear_session_cookie(response)
    return {"ok": True, "deleted": True}
