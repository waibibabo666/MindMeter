"""OpenAI 兼容的对话客户端。"""
from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx

from .config import settings
from .logging_setup import redact_text


def _clean_no_proxy_env() -> None:
    """httpx 0.28 无法解析 NO_PROXY 里的方括号 IPv6 项。

    如果后端不在桌面启动器里运行（开发 shell、测试），被污染的
    ``::1,[::1]`` 会让每个请求在建立连接前就抛 InvalidURL——用户看到的
    就是「配了 Key 但每次回答都回退模板」。
    """
    for name in ("NO_PROXY", "no_proxy"):
        value = os.environ.get(name, "")
        if value:
            os.environ[name] = ",".join(
                part
                for part in value.split(",")
                if part.strip() not in {"[::1]", "::1", ""}
            )


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
    finish_reason: str | None = None


@dataclass(frozen=True)
class LLMConfig:
    """站点级模型配置。``key`` 绝不能离开进程。"""

    endpoint: str
    model: str
    key: str
    enabled: bool
    # 备用模型链：免费池过载（智谱 1305 / HTTP 429）时按顺序降级，
    # 比整站退回模板更接近"AI 能力可用"的产品承诺。
    fallbacks: tuple[str, ...] = ()
    # 网关专属参数，例如智谱要显式关思考，否则 800 token 预算会被 think 段吃掉。
    extra_params: dict | None = None

    def chain(self) -> list[str]:
        seen: list[str] = []
        for name in (self.model, *self.fallbacks):
            value = str(name or "").strip()
            if value and value not in seen:
                seen.append(value)
        return seen

    def public(self) -> dict:
        """浏览器被允许知道的内容。"""
        return {
            "endpoint": self.endpoint,
            "model": self.model,
            "fallbackModels": list(self.fallbacks),
            "enabled": self.enabled,
            "hasKey": bool(self.key),
            "keyHint": mask_key(self.key) if self.key else "",
            "managedBy": "site",
            "readOnly": True,
        }


def _extra_params_for(endpoint: str) -> dict:
    """厂商专属参数：不发这些，回答格式会坏。"""
    host = urlsplit(endpoint).netloc.lower()
    if "bigmodel.cn" in host or "zhipu" in host:
        # GLM-4.5/4.7 默认开启动态思考；本产品的回答短且有格式约束，直接关掉。
        return {"thinking": {"type": "disabled"}}
    return {}


def _parse_extra_params(raw: str) -> dict | None:
    value = str(raw or "").strip()
    if not value:
        return None
    try:
        parsed = json.loads(value)
    except ValueError:
        return None
    return parsed if isinstance(parsed, dict) else None


def mask_key(value: str) -> str:
    value = str(value or "")
    if not value:
        return ""
    if len(value) <= 8:
        return "已配置"
    return f"{value[:3]}…{value[-4:]}"


def site_llm_config() -> LLMConfig:
    endpoint = settings.llm_endpoint or normalize_endpoint(settings.llm_base_url)
    key = str(settings.llm_api_key or "").strip()
    model = str(settings.llm_model or "").strip()
    fallbacks = tuple(
        item.strip() for item in str(settings.llm_model_fallbacks or "").split(",") if item.strip()
    )
    extra = _parse_extra_params(settings.llm_extra_params)
    if extra is None:
        extra = _extra_params_for(endpoint)
    return LLMConfig(
        endpoint=endpoint,
        model=model,
        key=key,
        enabled=bool(endpoint and model and key),
        fallbacks=fallbacks,
        extra_params=extra or None,
    )


def call_llm(
    *,
    endpoint: str,
    model: str,
    key: str,
    messages: list[dict],
    timeout_s: float | None = None,
    max_tokens: int = 600,
    temperature: float = 0.2,
    extra_params: dict | None = None,
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
    if isinstance(extra_params, dict):
        body.update(extra_params)
    timeout = timeout_s or settings.llm_timeout_s
    _clean_no_proxy_env()
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
    finish_reason = choices[0].get("finish_reason")
    if not isinstance(content, str) or not content.strip():
        if finish_reason == "length":
            raise LLMError("truncated", "模型输出达到 token 上限，已截断")
        raise LLMError("bad_response", "响应缺少 choices[0].message.content")
    if finish_reason == "length":
        raise LLMError("truncated", "模型输出达到 token 上限，已截断")
    return LLMReply(
        text=content.strip(),
        model=str(data.get("model") or model),
        finish_reason=finish_reason,
    )


# 只有这两类错误值得换模型/重试：厂商池子过载与临时超时。
# auth / bad_response / http(4xx-5xx 非 429) 换模型也不会变好，直接冒泡给调用方。
RETRYABLE = {"rate_limit", "timeout", "network"}


def call_llm_with_fallback(
    config: LLMConfig,
    messages: list[dict],
    *,
    max_tokens: int = 800,
    temperature: float | None = None,
    timeout_s: float | None = None,
) -> LLMReply:
    """主模型过载时退避重试，再按备用链降级；全失败才抛最后一个错误。

    免费池（智谱 glm-4.x-flash 这类共享容量）会在高峰期返回 1305/429。
    一次 429 就退回模板会让"AI 能力"看起来随机失灵，所以这里：
      1. 同一模型最多重试 `llm_retries` 次，指数退避；
      2. 仍失败就换 `llm_model_fallbacks` 里的下一个模型；
      3. 全链失败抛出最后一个错误码，由 Agent 决定模板兜底。
    """
    chain = config.chain() or [config.model]
    temperature = settings.llm_temperature if temperature is None else temperature
    last: LLMError | None = None

    for model in chain:
        for attempt in range(settings.llm_retries + 1):
            try:
                return call_llm(
                    endpoint=config.endpoint,
                    model=model,
                    key=config.key,
                    messages=messages,
                    timeout_s=timeout_s,
                    max_tokens=max_tokens,
                    temperature=temperature,
                    extra_params=config.extra_params,
                )
            except LLMError as error:
                last = error
                if error.code not in RETRYABLE:
                    raise
                if attempt >= settings.llm_retries:
                    break
                time.sleep(settings.llm_retry_backoff_s * (2**attempt))

    assert last is not None
    raise last
