"""OpenAI-compatible chat client used only by the local backend."""
from __future__ import annotations

from dataclasses import dataclass

import httpx

from .config import settings
from .logging_setup import redact_text


class LLMError(RuntimeError):
    def __init__(self, code: str, message: str, status: int | None = None):
        super().__init__(message)
        self.code = code
        self.status = status


def normalize_endpoint(endpoint: str) -> str:
    value = str(endpoint or "").strip()
    if not value:
        return ""
    trimmed = value.rstrip("/")
    if trimmed.lower().endswith("/chat/completions"):
        return trimmed
    return f"{trimmed}/chat/completions"


def is_configured(endpoint: str, model: str, key: str | None, enabled: bool) -> bool:
    return bool(enabled and endpoint and model and key)


@dataclass
class LLMReply:
    text: str
    model: str


def call_llm(
    *,
    endpoint: str,
    model: str,
    key: str,
    messages: list[dict],
    timeout_s: float | None = None,
    max_tokens: int = 600,
    temperature: float = 0.2,
) -> LLMReply:
    url = normalize_endpoint(endpoint)
    if not url:
        raise LLMError("not_configured", "未配置 endpoint")
    if not model or not key:
        raise LLMError("not_configured", "未配置 model 或 key")

    body = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    timeout = timeout_s or settings.llm_timeout_s
    try:
        with httpx.Client(timeout=httpx.Timeout(timeout, connect=10.0), follow_redirects=False) as client:
            response = client.post(
                url,
                json=body,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {key}",
                },
            )
    except httpx.TimeoutException as exc:
        raise LLMError("timeout", f"请求超过 {timeout:g}s 未返回") from exc
    except httpx.HTTPError as exc:
        raise LLMError("network", redact_text(f"网络请求失败：{exc}")) from exc

    if response.status_code in (401, 403):
        raise LLMError("auth", "鉴权失败：Key 无效或没有该模型权限", response.status_code)
    if response.status_code == 429:
        raise LLMError("rate_limit", "触发限流：请稍后再试", response.status_code)
    if response.status_code >= 400:
        raise LLMError("http", f"服务返回 {response.status_code}", response.status_code)

    try:
        data = response.json()
    except ValueError as exc:
        raise LLMError("bad_response", "响应不是合法 JSON") from exc

    choices = data.get("choices") if isinstance(data, dict) else None
    if not isinstance(choices, list) or not choices:
        raise LLMError("bad_response", "响应缺少 choices[0].message.content")
    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    content = message.get("content") if isinstance(message, dict) else None
    if not isinstance(content, str) or not content.strip():
        raise LLMError("bad_response", "响应缺少 choices[0].message.content")
    return LLMReply(text=content.strip(), model=str(data.get("model") or model))
