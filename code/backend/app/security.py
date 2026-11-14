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
from starlette.datastructures import Headers, MutableHeaders

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
    """Deprecated helper kept for import compatibility; use LocalGuardMiddleware."""
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


async def _send_json(send: Callable, status: int, code: str) -> None:
    """直接发一个最小的 JSON 响应，不经过任何中间件包装。"""
    body = json.dumps({"detail": code}).encode("utf-8")
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


class LocalGuardMiddleware:
    """纯 ASGI 版本的本地访问守卫。

    不用 FastAPI 的 `@app.middleware("http")`（BaseHTTPMiddleware）：那层会
    缓冲并重发响应体，和 StaticFiles 的流式 FileResponse 叠在一起时会报
    `h11: Too much data for declared Content-Length`。这里只在响应头上补安全
    头，响应体原样透传。
    """

    def __init__(self, app: Callable) -> None:
        self.app = app

    async def __call__(self, scope: dict, receive: Callable, send: Callable) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        if path.startswith("/api/"):
            client = scope.get("client") or ("", 0)
            headers = Headers(scope=scope)
            if client[0] not in {"127.0.0.1", "::1"}:
                await _send_json(send, 403, "loopback_only")
                return
            if not _host_ok(headers.get("host", "")):
                await _send_json(send, 400, "invalid_host")
                return
            if not _origin_ok(headers.get("origin", "")):
                await _send_json(send, 403, "invalid_origin")
                return
            token = headers.get("x-mm-token", "")
            if not settings.api_token or not hmac.compare_digest(token, settings.api_token):
                await _send_json(send, 401, "unauthorized")
                return

        async def send_with_headers(message: dict) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["X-Content-Type-Options"] = "nosniff"
                headers["Referrer-Policy"] = "no-referrer"
                headers["X-Frame-Options"] = "DENY"
                headers["Content-Security-Policy"] = CSP
                if path.startswith("/api/"):
                    headers["Cache-Control"] = "no-store"
            await send(message)

        await self.app(scope, receive, send_with_headers)


def json_error(status: int, code: str, message: str = "") -> JSONResponse:
    return JSONResponse(
        {"error": code, "message": message or code},
        status_code=status,
        headers={"Cache-Control": "no-store"},
    )


def audit_detail(**kwargs: object) -> dict:
    """Small helper to keep audit rows JSON-serializable."""
    return json.loads(json.dumps(kwargs, default=str))
