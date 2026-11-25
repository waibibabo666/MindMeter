"""托管 Web 应用的 HTTP 安全守卫。"""
from __future__ import annotations

import json
from collections.abc import Callable
from urllib.parse import urlsplit

from fastapi.responses import JSONResponse
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
    """允许没有 Origin 头的非浏览器客户端（curl、健康探针）。"""
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
    """安全响应头 + 对写接口做同源/JSON 校验。"""

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


def json_error(status: int, code: str, message: str = "") -> JSONResponse:
    return JSONResponse(
        {"error": code, "message": message or code},
        status_code=status,
        headers={"Cache-Control": "no-store"},
    )


def audit_detail(**kwargs: object) -> dict:
    """让审计行可 JSON 序列化的小工具。"""
    return json.loads(json.dumps(kwargs, default=str))
