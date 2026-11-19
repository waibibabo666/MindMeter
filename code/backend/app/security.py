"""HTTP guard for the hosted web app.

This replaces the desktop ``LocalGuardMiddleware`` (loopback + per-launch
token), which cannot work on a public host. Two things stay, one thing is new:

* the same security headers and strict same-origin CSP;
* state-changing ``/api/`` requests must be same-origin and JSON — that plus
  the ``SameSite=Lax`` session cookie is the CSRF defense (no token table,
  no extra round-trip);
* authentication itself is *not* decided here: ``app.auth.require_user`` is a
  FastAPI dependency, so every endpoint says explicitly whether it is public.

A pure ASGI middleware is used on purpose: BaseHTTPMiddleware buffers response
bodies and breaks ``StaticFiles`` streaming (h11 "Too much data").
"""
from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from urllib.parse import urlsplit

from fastapi import Request
from fastapi.responses import JSONResponse, Response
from starlette.datastructures import Headers, MutableHeaders

CSP = (
    "default-src 'self'; "
    "connect-src 'self'; "
    "img-src 'self' data:; "
    "style-src 'self' 'unsafe-inline'; "
    "script-src 'self'; "
    "base-uri 'none'; "
    "form-action 'self'; "
    "frame-ancestors 'none'"
)

SAFE_METHODS = {"GET", "HEAD", "OPTIONS", "TRACE"}
API_PREFIX = "/api/"


def _host_of(url: str) -> str:
    parts = urlsplit(url)
    return (parts.netloc or "").lower()


def same_origin(headers: Headers, host: str) -> bool:
    """No Origin header (non-browser client, curl, health probe) is allowed."""
    origin = headers.get("origin", "") or headers.get("referer", "")
    if not origin:
        return True
    return _host_of(origin) == (host or "").lower()


def _json_body(status: int, code: str) -> bytes:
    return json.dumps({"error": code, "message": code, "detail": code}).encode("utf-8")


async def _send_json(send: Callable, status: int, code: str) -> None:
    body = _json_body(status, code)
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
                (b"cache-control", b"no-store"),
                (b"x-content-type-options", b"nosniff"),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


class SecurityMiddleware:
    """Security headers + same-origin/JSON gate for mutating API calls."""

    def __init__(self, app: Callable) -> None:
        self.app = app

    async def __call__(self, scope: dict, receive: Callable, send: Callable) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        headers = Headers(scope=scope)
        method = str(scope.get("method", "GET")).upper()

        if path.startswith(API_PREFIX) and method not in SAFE_METHODS:
            if not same_origin(headers, headers.get("host", "")):
                await _send_json(send, 403, "invalid_origin")
                return
            length = headers.get("content-length", "")
            if length and length != "0":
                if "application/json" not in headers.get("content-type", "").lower():
                    await _send_json(send, 415, "json_body_required")
                    return

        async def send_with_headers(message: dict) -> None:
            if message["type"] == "http.response.start":
                out = MutableHeaders(scope=message)
                out["X-Content-Type-Options"] = "nosniff"
                out["Referrer-Policy"] = "no-referrer"
                out["X-Frame-Options"] = "DENY"
                out["Content-Security-Policy"] = CSP
                if path.startswith(API_PREFIX):
                    out["Cache-Control"] = "no-store"
                    out["Vary"] = "Cookie"
            await send(message)

        await self.app(scope, receive, send_with_headers)


# Kept for the desktop launcher's old import path; the web app does not use it.
LocalGuardMiddleware = SecurityMiddleware


async def enforce_local_request(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:  # pragma: no cover - compatibility shim
    return await call_next(request)


def json_error(status: int, code: str, message: str = "") -> JSONResponse:
    return JSONResponse(
        {"error": code, "message": message or code},
        status_code=status,
        headers={"Cache-Control": "no-store"},
    )


def audit_detail(**kwargs: object) -> dict:
    """Small helper to keep audit rows JSON-serializable."""
    return json.loads(json.dumps(kwargs, default=str))
