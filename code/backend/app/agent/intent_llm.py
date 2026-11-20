"""LLM 兜底意图分类：只在关键词规则拿不准时调用一次小请求。

为什么需要它（第 3 轮人工测试的结论）：用户问「回答不满意是 LLM 选型还是 agent
架构的问题」，答案是架构 —— 我们的"多类型 agent 路由"其实是**关键词规则**，
对措辞极度敏感（「我哪方面比较强」曾被"比较"两个字路由到趋势）。词表能修的已经修完，
剩下这类"表达千变万化、规则写不完"的兜底，交给模型判断比继续堆词表更稳。

三条硬约束（与 `classify.resolve_intent` 一一对应）：

1. 安全红线不交给模型：危机/越界/高风险领域/疏导/自责由关键词决定，
   这条模块根本不会被调用到它们上面；
2. 只在模糊时调用：`needs_llm_fallback()` 为假时不发请求，避免每次对话多一跳延迟；
3. 任何失败都等于没有这个功能：未配置模型、超时、返回不是闭集里的意图 → 返回 None，
   调用方沿用关键词结果。分类失败绝不能把对话拖挂。
"""
from __future__ import annotations

import json

from ..config import settings
from ..llm import LLMError, call_llm_with_fallback, site_llm_config
from .classify import LLM_ALLOWED_INTENTS, INTENT

# 分类是"读一句话归个类"，不需要思考、不需要长输出。
# 超时单独收紧：它排在真正回答之前，慢就等于整轮对话变慢。
CLASSIFY_MAX_TOKENS = 16
CLASSIFY_TIMEOUT_S = 6.0

# 意图码 → 给模型看的中文说明（模型答中文，代码里用英文码，两边只在这里映射一次）。
_INTENT_LABELS = {
    INTENT["EXPLAIN"]: "explain",
    INTENT["SUMMARY"]: "summary",
    INTENT["TREND"]: "trend",
    INTENT["CLARIFY"]: "clarify",
    INTENT["UNRELATED"]: "unrelated",
    INTENT["BOUNDARY"]: "boundary",
    INTENT["SUPPORT"]: "support",
    INTENT["SELF_BLAME"]: "self_blame",
}
_LABEL_INTENTS = {label: intent for intent, label in _INTENT_LABELS.items()}

SYSTEM_PROMPT = (
    "你只做一件事：判断用户这句话属于下面哪个意图，只输出意图英文码，不解释、不加标点。\n"
    "explain=问某个能力维度为什么高/低、怎么读这个分数；\n"
    "summary=问整体结果、强项弱项、下一步怎么安排或练什么；\n"
    "trend=明确在比较两次（或多次）测评的变化；\n"
    "clarify=指代不清、缺少对象，需要追问才能回答；\n"
    "unrelated=与本次测评结果无关（闲聊、别的领域任务）；\n"
    "boundary=要求疾病/心理诊断、用药或治疗结论；\n"
    "support=在说用户**自己本人**的情绪、压力、睡眠、身体状态或自我担忧（如「我有点担心自己」"
    "「最近状态一直不好」），这类一律答 support，不要答 clarify；\n"
    "self_blame=在贬低自己（我真笨、我脑子不行）。\n"
    "边界：问「这东西准吗/可信吗/有没有意义」是在问测评本身，属于 explain，**不是 support**；"
    "句子没有明确指代（如「那个呢」「你觉得呢」）时答 clarify，"
    "**不要靠猜把它归到 trend 或 explain**；判不准时答 clarify。"
)


def build_messages(question: str, history: list | None = None) -> list[dict]:
    """带最近两句上下文：光看「那第二个呢」是没法分类的。"""
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    recent = [item for item in (history or [])[-4:] if isinstance(item, dict)]
    turns: list[str] = []
    for item in recent:
        role = "用户" if item.get("role") == "user" else "助手"
        content = str(item.get("content") or "").strip()
        if content:
            turns.append(f"{role}：{content[:80]}")
    context = "\n".join(turns)
    user_block = f"最近对话：\n{context}\n\n当前问题：{question}" if context else f"当前问题：{question}"
    messages.append({"role": "user", "content": user_block})
    return messages


def parse_intent(raw: str) -> str | None:
    """把模型输出归一到闭集意图码；认不出来就返回 None（调用方回退关键词）。"""
    text = str(raw or "").strip().lower()
    if not text:
        return None
    # 模型偶尔会加引号、前缀或解释，取第一个能匹配上的意图码。
    for label in sorted(_LABEL_INTENTS, key=len, reverse=True):
        if label in text:
            return _LABEL_INTENTS[label]
    return None


def classify_with_llm(question: str, history: list | None = None) -> str | None:
    """返回意图码，或 None（未配置/失败/超时/不可解析）。"""
    config = site_llm_config()
    if not config.enabled:
        return None
    text = str(question or "").strip()
    if not text:
        return None

    try:
        reply = call_llm_with_fallback(
            config,
            build_messages(text, history),
            max_tokens=CLASSIFY_MAX_TOKENS,
            temperature=0.0,
            timeout_s=min(settings.llm_timeout_s, CLASSIFY_TIMEOUT_S),
        )
    except LLMError:
        # 分类是增强项，不是依赖项：任何模型侧问题都静默回退到关键词结果。
        return None
    except Exception:  # noqa: BLE001 - 网络/解析等意外同样不能拖挂对话
        return None

    intent = parse_intent(reply.text)
    return intent if intent in LLM_ALLOWED_INTENTS else None
