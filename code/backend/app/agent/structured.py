"""可选的结构化输出：让模型返回 JSON，再由代码组装成文本。

为什么可选（默认关闭）：
  * 不是所有 OpenAI 兼容模型都稳定遵守"只输出 JSON"；
  * 解析失败时必须能无损回退到纯文本，否则等于把回答交给运气。

开启方式：服务端环境变量 `MM_LLM_STRUCTURED=1`。
"""
from __future__ import annotations

import json
import re

FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


def parse_structured(text: str, allowed_ids: list[str] | None = None) -> dict | None:
    """解析 {answer, citations, basis}；任何不合规都返回 None（调用方回退纯文本）。"""
    raw = FENCE_RE.sub("", str(text or "")).strip()
    if not raw.startswith("{"):
        return None
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict):
        return None
    answer = data.get("answer")
    if not isinstance(answer, str) or not answer.strip():
        return None
    allowed = set(allowed_ids or [])
    cited = [item for item in (data.get("citations") or []) if isinstance(item, str)]
    if allowed:
        cited = [item for item in cited if item in allowed]
    basis = data.get("basis")
    parts = [answer.strip()]
    if isinstance(basis, str) and basis.strip():
        parts.append(f"依据：{basis.strip()}")
    for item in dict.fromkeys(cited):
        parts.append(f"引用：{item}")
    return {"text": "\n".join(parts), "citations": list(dict.fromkeys(cited))}


STRUCTURED_INSTRUCTION = (
    "只输出一个 JSON 对象，不要代码块、不要额外说明："
    '{"answer": "给用户的回答", "citations": ["引用的知识块编号"], "basis": "一句话说明依据"}。'
    "citations 只能从上面列出的知识块编号里选，没有就留空数组。"
)
