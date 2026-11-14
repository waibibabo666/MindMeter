"""LangGraph agent for the local assistant.

The graph is deliberately small: classify -> retrieve -> generate -> validate.
Crisis/boundary/unrelated/clarify never call a model. Any model failure falls
back to a template built from the current facts.
"""
from __future__ import annotations

import re
from contextvars import ContextVar
from typing import Any, TypedDict

from langgraph.graph import END, StateGraph
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import keyring_store
from ..analysis import build_messages as build_analysis_messages
from ..analysis import retrieve_context, template_analysis
from ..llm import LLMError, call_llm, is_configured
from ..models import AISettings
from ..rag import retrieve as retrieve_kb

INTENT = {
    "EXPLAIN": "explain",
    "CLARIFY": "clarify",
    "UNRELATED": "unrelated",
    "BOUNDARY": "boundary",
    "CRISIS": "crisis",
    "SUPPORT": "support",
    "HIGH_DOMAIN": "high_domain",
    "SUMMARY": "summary",
    "GREETING": "greeting",
}

RISK_BY_INTENT = {
    INTENT["CRISIS"]: "high",
    INTENT["BOUNDARY"]: "high",
    INTENT["HIGH_DOMAIN"]: "high",
    INTENT["SUPPORT"]: "medium",
    INTENT["UNRELATED"]: "low",
    INTENT["CLARIFY"]: "low",
    INTENT["EXPLAIN"]: "low",
    INTENT["SUMMARY"]: "low",
    INTENT["GREETING"]: "low",
}

CRISIS_WORDS = ["自杀", "自伤", "自残", "不想活", "活不下去", "结束生命", "伤害自己", "轻生", "绝望"]
BOUNDARY_WORDS = [
    "抑郁症",
    "抑郁",
    "焦虑症",
    "多动症",
    "ADHD",
    "自闭症",
    "精神病",
    "确诊",
    "诊断",
    "吃药",
    "药物",
    "用药",
    "治疗",
    "有病",
]
DIMENSION_WORDS = [
    "言语理解",
    "言语流畅",
    "数字运算",
    "知觉速度",
    "归纳推理",
    "空间视觉",
    "联想记忆",
    "自然探索",
]
DOMAIN_WORDS = [
    *DIMENSION_WORDS,
    "分数",
    "得分",
    "报告",
    "测评",
    "任务",
    "记忆",
    "建议",
    "练习",
    "总分",
    "档位",
    "未测",
]
EXPLAIN_WORDS = [
    "为什么",
    "怎么",
    "哪项",
    "哪一项",
    "什么意思",
    "解释",
    "原因",
    "建议",
    "练",
    "提高",
    "低",
    "高",
    "差",
    "提升",
    "怎么看",
]
HIGH_DOMAIN_WORDS = [
    "起诉",
    "法律",
    "律师",
    "投资",
    "股票",
    "基金",
    "贷款",
    "借钱",
    "黑客",
    "漏洞",
    "绕过",
    "违法",
    "安全风险",
]
SUPPORT_WORDS = [
    "压力",
    "睡不着",
    "失眠",
    "情绪低落",
    "难受",
    "崩溃",
    "疲惫",
    "很累",
]
SUMMARY_PHRASES = [
    "我的认知",
    "认知怎么样",
    "我的能力",
    "能力怎么样",
    "我的结果",
    "结果怎么样",
    "表现怎么样",
    "表现如何",
    "整体怎么样",
    "整体表现",
    "水平怎么样",
    "强项",
    "弱项",
    "短板",
    "总体",
]
GREETING_WORDS = ["你好", "您好", "hi", "hello", "在吗"]
UNRELATED_WORDS = [
    "天气",
    "股票",
    "基金",
    "翻译",
    "笑话",
    "写代码",
    "帮我写",
    "作文",
    "做饭",
    "电影",
    "游戏推荐",
    "旅游",
]

FIXED_REPLY = {
    INTENT["CLARIFY"]: "你指的是哪一项？可以说出维度名，比如「联想记忆」，我再解释。",
    INTENT["UNRELATED"]: "我只解释本次测评的结果。你可以问某个维度为什么低、或者下一步怎么练。",
    INTENT["BOUNDARY"]: "我不能判断疾病、也不能给用药或治疗建议。如果你担心自己的状态，请咨询医生或学校心理中心。",
    INTENT["CRISIS"]: "听到你这么说我很在意。请先联系身边的人，或拨打全国统一心理援助热线 12356。如果你现在有危险，请立即拨打 120。",
    INTENT["SUPPORT"]: "听起来你最近状态不太好。先保证休息和基本作息，找信任的人说一说；如果这种状态持续两周以上或已经影响学习生活，建议联系学校心理中心或医生。我不能做诊断，也不会用一次测评给你下结论。",
    INTENT["HIGH_DOMAIN"]: "这涉及法律、金融或安全方面的专业判断，我不能给这类建议，也不会用测评结果推断。请咨询持证专业人士；如果存在紧急人身或财产安全风险，请联系当地紧急服务。",
    INTENT["GREETING"]: "你好，我是 MindMeter 的解读助手。你可以直接问「我的认知怎么样」，或问某个维度为什么低、下一步怎么练。",
}

NO_KNOWLEDGE_REPLY = (
    "本地知识库里没有能直接回答这个问题的内容，我不猜。"
    "你可以换个问法（比如「联想记忆怎么练」），或查看报告里的原始指标。"
)

SUMMARY_SYSTEM_PROMPT = (
    "你是 MindMeter 的解读助手。"
    "只根据本次原始指标，用 2–3 句话概括本次表现：指出 1 个相对较好的方面和 1 个可关注的方面。"
    "只使用给定数字，不推断能力高低，不下诊断，不与人群比较，不提总分或百分位。"
    "不要编造知识块或引用；不超过 160 字。"
)

SYSTEM_PROMPT = (
    "你是 MindMeter 的解读助手。"
    "只解释给定的本次原始指标，不推断能力高低，不下诊断，不与人群比较。"
    "不要出现“总分”“百分位”“正常/异常”“治疗”等词。"
    "提到数字时只能用给定指标里的数字。"
    "如果提供了知识块，回答末尾另起一行写「引用：知识块编号 · 标题」。"
    "如果提供了用户画像或既往摘要，只用于调整详略、避免重复已给过的建议；"
    "其中出现的任何数字都不属于本次指标，不得引用。"
    "不超过 200 字。"
)

BANNED_WORDS = [
    "诊断",
    "确诊",
    "治疗",
    "症状",
    "疾病",
    "障碍",
    "药物",
    "用药",
    "服用",
    "就医",
    "抑郁",
    "焦虑症",
    "正常",
    "异常",
    "缺陷",
    "康复",
    "提升智商",
    "提高智力",
    "脑龄",
    "延缓衰老",
]
CITATION_RE = re.compile(r"引用\s*[:\uFF1A]|[Kk][Bb]-[A-Za-z0-9-]+|\bfacts\b")
NUMBER_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(分|次|题|个|秒|毫秒|ms|%|岁|项|°|度)?")


_DB: ContextVar[Session | None] = ContextVar("mm_agent_db", default=None)


class AgentState(TypedDict, total=False):
    question: str
    facts: dict
    history: list
    memory: dict
    intent: str
    matched: list
    chunks: list
    citations: list
    sources: list
    text: str
    source: str
    code: str
    risk: str
    valid: bool
    issues: list


def hits(text: str, words: list[str]) -> list[str]:
    return [word for word in words if word in text]


def classify(question: str) -> dict:
    text = str(question or "").strip()
    if not text:
        return {"intent": INTENT["CLARIFY"], "risk": "low", "matched": [], "reason": "empty"}
    explain = hits(text, EXPLAIN_WORDS)
    domain = hits(text, DOMAIN_WORDS)
    unrelated = hits(text, UNRELATED_WORDS)

    def result(intent: str, matched: list, reason: str) -> dict:
        return {
            "intent": intent,
            "risk": RISK_BY_INTENT.get(intent, "low"),
            "matched": matched,
            "reason": reason,
        }

    matched = hits(text, CRISIS_WORDS)
    if matched:
        return result(INTENT["CRISIS"], matched, "crisis-word")
    matched = hits(text, BOUNDARY_WORDS)
    if matched:
        return result(INTENT["BOUNDARY"], matched, "medical-word")
    matched = hits(text, HIGH_DOMAIN_WORDS)
    if matched:
        return result(INTENT["HIGH_DOMAIN"], matched, "high-domain-word")
    matched = hits(text, SUPPORT_WORDS)
    if matched:
        return result(INTENT["SUPPORT"], matched, "support-word")
    if any(phrase in text for phrase in SUMMARY_PHRASES):
        return result(INTENT["SUMMARY"], [], "summary-question")
    if hits(text, GREETING_WORDS):
        return result(INTENT["GREETING"], hits(text, GREETING_WORDS), "greeting")
    if unrelated and not domain:
        return result(INTENT["UNRELATED"], unrelated, "off-topic")
    if not domain and not explain:
        return result(INTENT["CLARIFY"], [], "no-domain-no-signal")
    if not domain and len(text) <= 8:
        return result(INTENT["CLARIFY"], explain, "too-short")
    return result(INTENT["EXPLAIN"], [*domain, *explain], "domain-question")


def fixed_reply(intent: str) -> str:
    return FIXED_REPLY.get(intent, FIXED_REPLY[INTENT["UNRELATED"]])


def collect_numbers(value: Any) -> list[float]:
    out: list[float] = []

    def walk(item: Any) -> None:
        if isinstance(item, (int, float)) and not isinstance(item, bool):
            out.append(float(item))
        elif isinstance(item, list):
            for child in item:
                walk(child)
        elif isinstance(item, dict):
            for child in item.values():
                walk(child)

    walk(value)
    return out


def _strip_citations(text: str) -> str:
    text = re.sub(r"引用\s*[:\uFF1A][^\n]*", "", text)
    return re.sub(r"[Kk][Bb]-[A-Za-z0-9-]+", "", text)


def extract_numbers(text: str) -> list[dict]:
    body = _strip_citations(str(text or ""))
    # "1. ..." / "2、..." are list markers, not result values.
    body = re.sub(r"(?m)^\s*\d+\s*[.、)）]\s*", " ", body)
    # Inline list markers such as "建议：1）… 2）…" are not result values.
    body = re.sub(r"(?<!\d)\d{1,2}\s*[）)]", " ", body)
    return [
        {"value": float(match.group(1)), "raw": match.group(0).strip(), "unit": match.group(2) or ""}
        for match in NUMBER_RE.finditer(body)
    ]


def validate_text(
    text: str,
    allowed_numbers: list[float] | None = None,
    require_citation: bool = False,
    max_chars: int = 200,
) -> dict:
    value = str(text or "").strip()
    if not value:
        return {"ok": False, "issues": [{"code": "empty", "detail": "回答为空"}], "chars": 0}
    issues: list[dict] = []
    chars = len(value)
    if chars > max_chars:
        issues.append({"code": "too_long", "detail": f"{chars} 字，上限 {max_chars} 字"})
    banned = [word for word in BANNED_WORDS if word in value]
    if banned:
        issues.append({"code": "banned_word", "detail": "命中禁用词：" + "、".join(banned)})
    if require_citation and not CITATION_RE.search(value):
        issues.append({"code": "missing_citation", "detail": "缺少来源标注"})
    allowed = {float(v) for v in (allowed_numbers or [])}
    unsourced = [
        n
        for n in extract_numbers(value)
        if n["value"] not in allowed and n["unit"] not in {"°", "度"}
    ]
    if unsourced:
        issues.append(
            {
                "code": "unsourced_number",
                "detail": "数字不在 facts 中：" + "、".join(n["raw"] for n in unsourced),
            }
        )
    return {"ok": not issues, "issues": issues, "chars": chars}


def _ps_metrics(metrics: dict) -> tuple[object, object]:
    total = metrics.get("trials")
    correct = metrics.get("correct")
    if total is None:
        parts = [
            metrics.get("encCorrect"),
            metrics.get("encWrong"),
            metrics.get("catCorrect"),
            metrics.get("catWrong"),
        ]
        if any(isinstance(part, (int, float)) for part in parts):
            total = sum(part for part in parts if isinstance(part, (int, float)))
    if correct is None:
        parts = [metrics.get("encCorrect"), metrics.get("catCorrect")]
        if any(isinstance(part, (int, float)) for part in parts):
            correct = sum(part for part in parts if isinstance(part, (int, float)))
    return total, correct


def template_explanation(facts: dict) -> str:
    labels = {
        "vc": lambda m: f"言语理解正确 {m.get('correct')}/{m.get('total')}",
        "sv": lambda m: f"空间视觉化正确 {m.get('correct')}/{m.get('total')}",
        "am": lambda m: f"联想记忆命中 {m.get('hits')}、虚报 {m.get('falseAlarms')}",
    }
    lines = []
    for dim, metrics in (facts or {}).items():
        if not isinstance(metrics, dict):
            continue
        if dim == "ps":
            total, correct = _ps_metrics(metrics)
            if total is not None and correct is not None:
                lines.append(f"· 知觉速度 {metrics.get('seconds', '—')} 秒内完成 {total} 题、正确 {correct}")
        elif dim in labels:
            lines.append(f"· {labels[dim](metrics)}")
    if not lines:
        return "本次还没有可解读的原始指标。完成测评后会在这里给出说明。"
    return "\n".join(
        [
            "本次完成的原始指标：",
            *lines,
            "",
            "这些只是本次测得的原始数据，不是分数，也不与人群比较。",
            "分数由服务端按 scoring-v3.1 折算。",
        ]
    )


def memory_lines(memory: dict | None) -> list[str]:
    if not memory:
        return []
    lines: list[str] = []
    profile = memory.get("profile") or {}
    if profile and profile.get("confirmed"):
        parts = []
        for key, label in (("goal", "目标"), ("preference", "偏好"), ("constraint", "约束")):
            if profile.get(key):
                parts.append(f"{label}：{profile[key]}")
        if parts:
            lines.append("用户画像（已确认）：" + "；".join(parts))
    if memory.get("summaryText"):
        lines.append("最近一次测评摘要：" + str(memory["summaryText"]))
    advice = memory.get("advice") or []
    if advice:
        shown = "、".join(
            f"{item.get('id')}{'（已完成）' if item.get('done') else '（未完成）'}" for item in advice
        )
        lines.append(f"已给过的建议：{shown}。不要原样重复，可在其基础上递进。")
    return lines


def build_messages(
    question: str,
    facts: dict,
    chunks: list[dict],
    history: list,
    memory: dict | None,
    summary: bool = False,
) -> list[dict]:
    history = [
        {"role": item.get("role") if item.get("role") == "assistant" else "user", "content": str(item.get("content") or "")}
        for item in (history or [])[-6:]
    ]
    blocks = [
        "本次原始指标：\n" + ("\n".join(f"{k}: {v}" for k, v in (facts or {}).items()) or "（无）"),
        "可引用知识块：\n" + ("\n".join(f"{c['id']} · {c['title']}：{c['text']}" for c in chunks) or "（无）"),
    ]
    extra = memory_lines(memory)
    if extra:
        blocks.append("用户背景（只用于调整表述，不作为数字来源）：\n" + "\n".join(extra))
    blocks.append("用户问题：" + question)
    prompt = SUMMARY_SYSTEM_PROMPT if summary else SYSTEM_PROMPT
    return [{"role": "system", "content": prompt}, {"role": "user", "content": "\n\n".join(blocks)}, *history]


def _classify_node(state: AgentState) -> dict:
    result = classify(state.get("question", ""))
    return {
        "intent": result["intent"],
        "risk": result["risk"],
        "matched": result["matched"],
    }


def _retrieve_node(state: AgentState) -> dict:
    db = _DB.get()
    if db is None:
        return {
            "chunks": [],
            "text": NO_KNOWLEDGE_REPLY,
            "source": "template",
            "code": "no_knowledge",
        }
    if state.get("intent") == INTENT["SUMMARY"]:
        chunks = retrieve_context(db, state.get("facts") or {}, limit=6)
    else:
        chunks = retrieve_kb(db, state.get("question", ""), limit=3)
    if not chunks and state.get("intent") != INTENT["SUMMARY"]:
        return {
            "chunks": [],
            "text": NO_KNOWLEDGE_REPLY,
            "source": "template",
            "code": "no_knowledge",
        }
    return {
        "chunks": chunks,
        "citations": [c["id"] for c in chunks],
        "sources": [
            {
                "id": c["id"],
                "title": c.get("title", ""),
                "text": c.get("text", ""),
                "source": c.get("source") or {},
            }
            for c in chunks
        ],
    }


def _fixed_node(state: AgentState) -> dict:
    intent = state.get("intent", INTENT["UNRELATED"])
    return {
        "text": fixed_reply(intent),
        "source": "policy",
        "code": f"intent:{intent}",
        "risk": state.get("risk") or RISK_BY_INTENT.get(intent, "low"),
    }


def _fallback_analysis(facts: dict, chunks: list[dict], summary: bool) -> str:
    if summary or chunks:
        return template_analysis(facts, chunks)
    return template_explanation(facts)


def _generate_node(state: AgentState) -> dict:
    db = _DB.get()
    facts = state.get("facts") or {}
    chunks = state.get("chunks") or []
    summary = state.get("intent") == INTENT["SUMMARY"]
    if db is None:
        return {
            "text": _fallback_analysis(facts, chunks, summary),
            "source": "template",
            "code": "unknown",
        }
    row = db.scalar(select(AISettings).limit(1))
    key = keyring_store.get_llm_key()
    if row is None or not is_configured(row.endpoint, row.model, key, row.enabled):
        return {
            "text": _fallback_analysis(facts, chunks, summary),
            "source": "template",
            "code": "not_configured",
        }
    try:
        messages = (
            build_analysis_messages(facts, chunks, state.get("question", ""))
            if summary
            else build_messages(
                state.get("question", ""),
                facts,
                chunks,
                state.get("history") or [],
                state.get("memory"),
            )
        )
        reply = call_llm(
            endpoint=row.endpoint,
            model=row.model,
            key=key or "",
            messages=messages,
            max_tokens=3000 if summary else 800,
        )
        return {"text": reply.text, "source": "llm", "code": "ok"}
    except LLMError as exc:
        return {
            "text": _fallback_analysis(facts, chunks, summary),
            "source": "template",
            "code": exc.code,
        }
    except Exception:
        return {
            "text": _fallback_analysis(facts, chunks, summary),
            "source": "template",
            "code": "unknown",
        }


def _validate_node(state: AgentState) -> dict:
    if state.get("source") != "llm":
        return {"valid": True, "issues": []}
    summary = state.get("intent") == INTENT["SUMMARY"]
    result = validate_text(
        state.get("text", ""),
        allowed_numbers=collect_numbers(state.get("facts") or {}),
        require_citation=summary and bool(state.get("chunks")),
        max_chars=900 if summary else 200,
    )
    if result["ok"]:
        return {"valid": True, "issues": []}
    return {
        "valid": False,
        "issues": result["issues"],
        "text": _fallback_analysis(
            state.get("facts") or {},
            state.get("chunks") or [],
            state.get("intent") == INTENT["SUMMARY"],
        ),
        "source": "template",
        "code": "invalid",
    }


def _after_classify(state: AgentState) -> str:
    if state.get("intent") == INTENT["EXPLAIN"]:
        return "retrieve"
    if state.get("intent") == INTENT["SUMMARY"]:
        return "retrieve"
    return "fixed"


def _after_retrieve(state: AgentState) -> str:
    if state.get("intent") == INTENT["SUMMARY"]:
        return "generate"
    return "generate" if state.get("chunks") else "end"


def _build_graph():
    builder = StateGraph(AgentState)
    builder.add_node("classify", _classify_node)
    builder.add_node("retrieve", _retrieve_node)
    builder.add_node("generate", _generate_node)
    builder.add_node("validate", _validate_node)
    builder.add_node("fixed", _fixed_node)
    builder.set_entry_point("classify")
    builder.add_conditional_edges(
        "classify",
        _after_classify,
        {"retrieve": "retrieve", "generate": "generate", "fixed": "fixed"},
    )
    builder.add_conditional_edges("retrieve", _after_retrieve, {"generate": "generate", "end": END})
    builder.add_edge("generate", "validate")
    builder.add_edge("validate", END)
    builder.add_edge("fixed", END)
    return builder.compile()


_GRAPH = _build_graph()


def answer(db: Session, question: str, facts: dict, history: list, memory: dict | None) -> dict:
    # Every turn starts from a clean graph state. The graph intentionally has no
    # checkpointer: chat history comes from PostgreSQL, not from a previous node's
    # text/citations (which caused stale safety replies to leak across turns).
    state = {
        "question": question,
        "facts": facts,
        "history": history,
        "memory": memory or {},
        "intent": "",
        "risk": "low",
        "chunks": [],
        "citations": [],
        "sources": [],
        "text": "",
        "source": "",
        "code": "",
        "valid": False,
        "issues": [],
    }
    token = _DB.set(db)
    try:
        result = _GRAPH.invoke(state)
    finally:
        _DB.reset(token)
    return {
        "intent": result.get("intent", INTENT["EXPLAIN"]),
        "risk": result.get("risk", "low"),
        "text": result.get("text", ""),
        "citations": result.get("citations", []),
        "sources": result.get("sources", []),
        "source": result.get("source", "template"),
        "code": result.get("code", "ok"),
    }
