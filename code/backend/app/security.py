"""Local-only API guard.

The backend binds to 127.0.0.1 and requires a per-launch token. We also reject
non-loopback Host headers and cross-origin browser requests. There is no CORS
middleware: the UI is served from the same origin.
"""
from __future__ import annotations

import hmac
import json
from collections.abc import Awaitable, Callable

from fastapi import Request
from fastapi.responses import JSONResponse, Response

from .config import settings

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


def _host_ok(host: str) -> bool:
    if not host:
        return False
    hostname = host.rsplit(":", 1)[0] if host.count(":") == 1 else host
    return hostname in {"127.0.0.1", "localhost"}


def _origin_ok(origin: str) -> bool:
    if not origin:
        return True
    return origin.startswith("http://127.0.0.1") or origin.startswith("http://localhost")


async def enforce_local_request(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    path = request.url.path

    if path.startswith("/api/"):
        if request.client is None or request.client.host not in {"127.0.0.1", "::1"}:
            return JSONResponse({"detail": "loopback_only"}, status_code=403)
        if not _host_ok(request.headers.get("host", "")):
            return JSONResponse({"detail": "invalid_host"}, status_code=400)
        if not _origin_ok(request.headers.get("origin", "")):
            return JSONResponse({"detail": "invalid_origin"}, status_code=403)
        token = request.headers.get("x-mm-token", "")
        if not settings.api_token or not hmac.compare_digest(token, settings.api_token):
            return JSONResponse({"detail": "unauthorized"}, status_code=401)

    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = CSP
    if path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


def json_error(status: int, code: str, message: str = "") -> JSONResponse:
    return JSONResponse(
        {"error": code, "message": message or code},
        status_code=status,
        headers={"Cache-Control": "no-store"},
    )


def audit_detail(**kwargs: object) -> dict:
    """Small helper to keep audit rows JSON-serializable."""
    return json.loads(json.dumps(kwargs, default=str))
