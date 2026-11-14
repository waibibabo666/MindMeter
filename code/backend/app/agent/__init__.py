"""LangGraph agent for the local assistant.

The graph is deliberately small: classify -> retrieve -> generate -> validate.
Crisis/boundary/self-blame/unrelated/clarify never call a model. Any model
failure falls back to a per-scene deterministic template. All generation and
validation rules for a scene live in `policies.SCENE_POLICIES` so the chat
page, the trend explanation and the report card share ONE guarded output path
(docs/software/agent-trend-workflow.md, docs/adr/0002).
"""
from __future__ import annotations

import math
import re
import time
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
from ..templates import template_narrative, template_trend
from .policies import SCOPE_MARKERS, DEFAULT_SCENE, policy_for, prompt_for

INTENT = {
    "EXPLAIN": "explain",
    "CLARIFY": "clarify",
    "UNRELATED": "unrelated",
    "BOUNDARY": "boundary",
    "CRISIS": "crisis",
    "TREND": "trend",
    "SELF_BLAME": "self_blame",
    "TREND_NO_DATA": "trend_no_data",
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
    INTENT["TREND"]: "low",
    INTENT["SELF_BLAME"]: "low",
    INTENT["TREND_NO_DATA"]: "low",
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
ADVICE_PHRASES = [
    "给点建议",
    "给些建议",
    "有什么建议",
    "有啥建议",
    "下一步怎么办",
    "下一步怎么练",
    "怎么提升",
    "如何提升",
]
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
# 趋势触发词：强词单独出现即可路由；弱词必须与维度名/分数语境同现，
# 避免「上次那个建议怎么还没做」这类跟进句被误读成趋势解释。
TREND_STRONG_WORDS = ["趋势", "对比", "比较", "变化", "复测", "差多少", "有什么不一样"]
TREND_WEAK_WORDS = ["上次", "涨跌"]
TREND_CONTEXT_WORDS = [*DIMENSION_WORDS, "分数", "得分", "这次", "两次", "复测"]
# 自责重导向（ADR-0002 决策 6）：主语与贬义 6 字窗内共现才触发，
# 「这个方法没用」这类指向物的句子不触发。
SELF_BLAME_RE = re.compile(
    r"(?:我|自己)[^，,。;；！!？?\s]{0,6}(?:笨|蠢|废物|没用|脑子不行|脑子坏了)"
)

FIXED_REPLY = {
    INTENT["CLARIFY"]: "你指的是哪一项？可以说出维度名，比如「联想记忆」，我再解释。",
    INTENT["UNRELATED"]: "我只解释本次测评的结果。你可以问某个维度为什么低、或者下一步怎么练。",
    INTENT["BOUNDARY"]: "我不能判断疾病、也不能给用药或治疗建议。如果你担心自己的状态，请咨询医生或学校心理中心。",
    INTENT["CRISIS"]: "听到你这么说我很在意。请先联系身边的人，或拨打全国统一心理援助热线 12356。如果你现在有危险，请立即拨打 120。",
    INTENT["SELF_BLAME"]: (
        "这句话不是测评能得出的结论。我能说的是这次任务的条件：题目形式、限时方式、上一题的影响。"
        "想拆开看哪一部分，可以说一个维度名，比如『联想记忆』。"
    ),
    INTENT["TREND_NO_DATA"]: "本机还没有两次可比的测评。完成一次标准测评后，这里才能解释变化。",
    INTENT["SUPPORT"]: "听起来你最近状态不太好。先保证休息和基本作息，找信任的人说一说；如果这种状态持续两周以上或已经影响学习生活，建议联系学校心理中心或医生。我不能做诊断，也不会用一次测评给你下结论。",
    INTENT["HIGH_DOMAIN"]: "这涉及法律、金融或安全方面的专业判断，我不能给这类建议，也不会用测评结果推断。请咨询持证专业人士；如果存在紧急人身或财产安全风险，请联系当地紧急服务。",
    INTENT["GREETING"]: "你好，我是 MindMeter 的解读助手。你可以直接问「我的认知怎么样」，或问某个维度为什么低、下一步怎么练。",
}

NO_KNOWLEDGE_REPLY = (
    "本地知识库里没有能直接回答这个问题的内容，我不猜。"
    "你可以换个问法（比如「联想记忆怎么练」），或查看报告里的原始指标。"
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
    "减退",
    "受损",
    "退化",
]
CITATION_RE = re.compile(r"引用\s*[:\uFF1A]|[Kk][Bb]-[A-Za-z0-9-]+|\bfacts\b")
NUMBER_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(分|次|题|个|秒|毫秒|ms|%|岁|项|°|度)?")
TRAILING_CITATION_RE = re.compile(r"\n*引用\s*[:\uFF1A][^\n]*\s*$")

_DB: ContextVar[Session | None] = ContextVar("mm_agent_db", default=None)


class AgentState(TypedDict, total=False):
    question: str
    facts: dict
    history: list
    memory: dict
    scene: str
    intent: str
    matched: list
    chunks: list
    citations: list
    sources: list
    text: str
    source: str
    code: str
    risk: str
    model: str
    latency_ms: int
    validation: list
    valid: bool
    issues: list


def hits(text: str, words: list[str]) -> list[str]:
    return [word for word in words if word in text]


def classify(question: str) -> dict:
    text = str(question or "").strip()
    if not text:
        return {"intent": INTENT["CLARIFY"], "matched": [], "reason": "empty"}
    explain = hits(text, EXPLAIN_WORDS)
    domain = hits(text, DOMAIN_WORDS)
    unrelated = hits(text, UNRELATED_WORDS)

    matched = hits(text, CRISIS_WORDS)
    if matched:
        return {"intent": INTENT["CRISIS"], "matched": matched, "reason": "crisis-word"}
    matched = hits(text, BOUNDARY_WORDS)
    if matched:
        return {"intent": INTENT["BOUNDARY"], "matched": matched, "reason": "medical-word"}
    matched = hits(text, HIGH_DOMAIN_WORDS)
    if matched:
        return {"intent": INTENT["HIGH_DOMAIN"], "matched": matched, "reason": "high-domain-word"}
    blame = SELF_BLAME_RE.search(text)
    if blame:
        return {"intent": INTENT["SELF_BLAME"], "matched": [blame.group(0)], "reason": "self-blame"}
    matched = hits(text, SUPPORT_WORDS)
    if matched:
        return {"intent": INTENT["SUPPORT"], "matched": matched, "reason": "support-word"}
    if any(phrase in text for phrase in ADVICE_PHRASES):
        return {"intent": INTENT["SUMMARY"], "matched": [], "reason": "advice-question"}
    if unrelated and not domain:
        return {"intent": INTENT["UNRELATED"], "matched": unrelated, "reason": "off-topic"}
    trend = hits(text, TREND_STRONG_WORDS)
    if trend or (
        hits(text, TREND_WEAK_WORDS) and hits(text, TREND_CONTEXT_WORDS)
    ):
        return {
            "intent": INTENT["TREND"],
            "matched": [*trend, *hits(text, TREND_WEAK_WORDS)],
            "reason": "trend-word",
        }
    if any(phrase in text for phrase in SUMMARY_PHRASES):
        return {"intent": INTENT["SUMMARY"], "matched": [], "reason": "summary-question"}
    greeting = hits(text, GREETING_WORDS)
    if greeting:
        return {"intent": INTENT["GREETING"], "matched": greeting, "reason": "greeting"}
    if not domain and not explain:
        return {"intent": INTENT["CLARIFY"], "matched": [], "reason": "no-domain-no-signal"}
    if not domain and len(text) <= 8:
        return {"intent": INTENT["CLARIFY"], "matched": explain, "reason": "too-short"}
    return {"intent": INTENT["EXPLAIN"], "matched": [*domain, *explain], "reason": "domain-question"}


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


def _derived_from_metrics(metrics: dict) -> set[float]:
    """Deterministic one-step derivations of the numbers inside ONE dimension.

    Sums/abs-differences between the dimension's metric values, integer
    percentages of any value over another value or over a pairwise sum (so
    "正确率 = hits/(hits+falseAlarms)" passes), and meanRtMs → seconds.
    Nothing chained beyond that.
    """
    values = [v for v in metrics.values() if isinstance(v, (int, float)) and not isinstance(v, bool)]
    out: set[float] = set()
    for a in values:
        for b in values:
            out.add(float(a + b))
            out.add(float(abs(a - b)))
    denominators = set(values) | {
        float(a) + float(b)
        for a in values
        for b in values
    }
    for a in values:
        for denom in denominators:
            if not denom:
                continue
            pct = float(a) / float(denom) * 100.0
            out.add(float(round(pct)))
            out.add(float(math.floor(pct)))
            out.add(float(math.ceil(pct)))
    rt = metrics.get("meanRtMs")
    if isinstance(rt, (int, float)) and rt:
        out.add(float(round(rt / 1000.0, 1)))
        out.add(float(round(rt / 1000.0)))
    return out


def derived_allowed_numbers(facts: dict | None) -> set[float]:
    allowed = set(collect_numbers(facts or {}))
    for key, metrics in (facts or {}).items():
        if key == "trend" or not isinstance(metrics, dict):
            continue
        allowed |= _derived_from_metrics(metrics)
    return allowed


def _strip_citations(text: str) -> str:
    text = re.sub(r"引用\s*[:\uFF1A][^\n]*", "", text)
    return re.sub(r"[Kk][Bb]-[A-Za-z0-9-]+", "", text)


def extract_numbers(text: str) -> list[dict]:
    body = _strip_citations(str(text or ""))
    body = re.sub(r"(?m)^\s*\d+\s*[.、)）]\s*", " ", body)
    body = re.sub(r"(?<!\d)\d{1,2}\s*[）)]", " ", body)
    return [
        {"value": float(match.group(1)), "raw": match.group(0).strip(), "unit": match.group(2) or ""}
        for match in NUMBER_RE.finditer(body)
    ]


def validate_text(
    text: str, allowed_numbers: list[float] | set[float] | None = None, policy: dict | None = None
) -> dict:
    """Policy-driven validation. Issues carry a severity: a hard issue fails
    the answer (deterministic template takes over); a soft issue is recorded
    for telemetry but keeps the LLM answer (citation/scope-note, §5.1)."""
    rule = policy or policy_for(DEFAULT_SCENE)
    value = str(text or "").strip()
    if not value:
        return {"ok": False, "issues": [{"code": "empty", "detail": "回答为空", "severity": "hard"}], "chars": 0}
    issues: list[dict] = []
    chars = len(value)

    def add(code: str, detail: str, severity: str = "hard") -> None:
        issues.append({"code": code, "detail": detail, "severity": severity})

    limit = int(rule.get("max_chars", 200))
    if chars > limit:
        add("too_long", f"{chars} 字，上限 {limit} 字")
    banned = [word for word in [*BANNED_WORDS, *(rule.get("extra_banned") or [])] if word in value]
    if banned:
        add("banned_word", "命中禁用词：" + "、".join(banned))
    allowed = {float(v) for v in (allowed_numbers or [])}
    unsourced = [
        n
        for n in extract_numbers(value)
        if n["value"] not in allowed and n["unit"] not in {"°", "度"}
    ]
    if unsourced:
        add("unsourced_number", "数字不在 facts 中：" + "、".join(n["raw"] for n in unsourced))

    citation_mode = rule.get("require_citation", "soft")
    if citation_mode != "off" and not CITATION_RE.search(value):
        add("citation_missing", "缺少来源标注", "hard" if citation_mode == "hard" else "soft")
    scope_mode = rule.get("require_scope_note", "soft")
    if scope_mode != "off" and not any(marker in value for marker in SCOPE_MARKERS):
        add("scope_note_missing", "缺少“不能说明什么”声明", "hard" if scope_mode == "hard" else "soft")

    hard = [issue for issue in issues if issue["severity"] == "hard"]
    return {"ok": not hard, "issues": issues, "chars": chars}


def template_explanation(facts: dict) -> str:
    labels = {
        "vc": lambda m: f"言语理解正确 {m.get('correct')}/{m.get('total')}",
        "ps": lambda m: f"知觉速度 {m.get('seconds')} 秒内完成 {m.get('trials')} 题、正确 {m.get('correct')}",
        "sv": lambda m: f"空间视觉化正确 {m.get('correct')}/{m.get('total')}",
        "am": lambda m: f"联想记忆命中 {m.get('hits')}、虚报 {m.get('falseAlarms')}",
    }
    lines = []
    for dim, metrics in (facts or {}).items():
        if dim in labels and isinstance(metrics, dict):
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


def scene_template(state: dict) -> str:
    """Deterministic fallback per scene (no blank output on any degradation)."""
    scene = state.get("scene") or DEFAULT_SCENE
    facts = state.get("facts") or {}
    if scene == "report":
        return template_narrative(facts)
    if scene == "trend":
        return template_trend(facts.get("trend") or {})
    return template_explanation(facts)


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


def _facts_line(facts: dict) -> str:
    parts = []
    for key, value in (facts or {}).items():
        if key == "trend":
            continue
        parts.append(f"{key}: {value}")
    return "\n".join(parts)


def _trend_block(trend: dict) -> str:
    lines = []
    for row in trend.get("rows") or []:
        sign = "+" if row["delta"] > 0 else ""
        lines.append(f"· {row.get('name', row.get('id'))} {row['prev']} → {row['next']}（{sign}{row['delta']}）")
    skipped = sorted(set([*(trend.get("onlyPrev") or []), *(trend.get("onlyNext") or [])]))
    days = trend.get("days")
    tail = []
    if days is not None:
        tail.append(f"间隔 {days} 天" + ("（少于 7 天，练习效应可能影响结果）" if trend.get("repeatRisk") else ""))
    if skipped:
        tail.append("未参与对比的维度：" + "、".join(skipped))
    return "两次对比数据：\n" + "\n".join(lines) + ("\n" + "；".join(tail) if tail else "")


def build_messages(
    question: str,
    facts: dict,
    chunks: list[dict],
    history: list,
    memory: dict | None,
    scene: str = DEFAULT_SCENE,
) -> list[dict]:
    prior = [
        {
            "role": item.get("role") if item.get("role") == "assistant" else "user",
            "content": str(item.get("content") or ""),
        }
        for item in (history or [])[-6:]
    ]
    blocks = [
        "本次原始指标：\n" + (_facts_line(facts) or "（无）"),
        "可引用知识块：\n" + ("\n".join(f"{c['id']} · {c['title']}：{c['text']}" for c in chunks) or "（无）"),
    ]
    if isinstance(facts, dict) and facts.get("trend"):
        blocks.append(_trend_block(facts["trend"]))
    extra = memory_lines(memory)
    if extra:
        blocks.append("用户背景（只用于调整表述，不作为数字来源）：\n" + "\n".join(extra))
    blocks.append("用户问题：" + question)
    # 时序修正：旧对话在前，当前问题在最后（此前把 history 拼在问题之后）。
    return [{"role": "system", "content": prompt_for(scene)}, *prior, {"role": "user", "content": "\n\n".join(blocks)}]


def _classify_node(state: AgentState) -> dict:
    if state.get("scene") == "report":
        return {"intent": INTENT["EXPLAIN"], "risk": "low", "matched": []}
    result = classify(state.get("question", ""))
    # TREND 意图自动切换 scene，让校验与模板走趋势策略；其余保持入口 scene。
    update: dict = {
        "intent": result["intent"],
        "risk": RISK_BY_INTENT.get(result["intent"], "low"),
        "matched": result["matched"],
    }
    if result["intent"] == INTENT["TREND"]:
        update["scene"] = "trend"
    if result["intent"] == INTENT["SUMMARY"]:
        update["scene"] = "summary"
    return update


def _retrieve_node(state: AgentState) -> dict:
    db = _DB.get()
    if db is None:
        return {"chunks": []}
    if state.get("intent") == INTENT["SUMMARY"]:
        chunks = retrieve_context(db, state.get("facts") or {}, limit=8)
    else:
        chunks = retrieve_kb(db, state.get("question", ""), limit=3)
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


def _no_trend_node(state: AgentState) -> dict:
    return {
        "text": FIXED_REPLY[INTENT["TREND_NO_DATA"]],
        "source": "template",
        "code": "trend_no_data",
    }


def _generate_node(state: AgentState) -> dict:
    scene = state.get("scene") or DEFAULT_SCENE
    facts = state.get("facts") or {}
    chunks = state.get("chunks") or []
    summary = state.get("intent") == INTENT["SUMMARY"] or scene == "report"
    domain_hit = any(word in (state.get("matched") or []) for word in DOMAIN_WORDS)
    trend_question = state.get("intent") == INTENT["TREND"] or scene == "trend"
    if (
        not chunks
        and not trend_question
        and not summary
        and (not domain_hit or not _facts_line(facts))
    ):
        return {"chunks": [], "text": NO_KNOWLEDGE_REPLY, "code": "no_knowledge", "source": "template"}
    db = _DB.get()
    fallback = template_analysis(facts, chunks) if summary else scene_template(state)
    if db is None:
        return {"text": fallback, "source": "template", "code": "unknown"}
    row = db.scalar(select(AISettings).limit(1))
    key = keyring_store.get_llm_key()
    if row is None or not is_configured(row.endpoint, row.model, key, row.enabled):
        return {"text": fallback, "source": "template", "code": "not_configured"}
    started = time.monotonic()
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
                scene,
            )
        )
        reply = call_llm(
            endpoint=row.endpoint,
            model=row.model,
            key=key or "",
            messages=messages,
            max_tokens=3000 if summary else 800,
        )
        latency = int((time.monotonic() - started) * 1000)
        return {"text": reply.text, "source": "llm", "code": "ok", "model": reply.model, "latency_ms": latency}
    except LLMError as exc:
        return {
            "text": fallback,
            "source": "template",
            "code": exc.code,
            "latency_ms": int((time.monotonic() - started) * 1000),
        }
    except Exception:
        return {
            "text": fallback,
            "source": "template",
            "code": "unknown",
            "latency_ms": int((time.monotonic() - started) * 1000),
        }


def _validate_node(state: AgentState) -> dict:
    if state.get("source") != "llm":
        return {"valid": True, "issues": []}
    rule = dict(policy_for(state.get("scene")))
    if not state.get("chunks"):
        # 知识块为空时不要求引用（facts-only 回答是合法分级，见 §3 RAG 行）。
        rule["require_citation"] = "off"
    result = validate_text(
        state.get("text", ""), allowed_numbers=derived_allowed_numbers(state.get("facts")), policy=rule
    )
    if result["ok"]:
        soft = [issue["code"] for issue in result["issues"] if issue["severity"] == "soft"]
        out: dict = {"valid": True, "issues": result["issues"], "validation": result["issues"]}
        if soft:
            out["code"] = soft[0]
        return out
    summary = state.get("intent") == INTENT["SUMMARY"] or state.get("scene") == "report"
    facts = state.get("facts") or {}
    has_score = any(
        isinstance(metrics.get("score"), int)
        for metrics in facts.values()
        if isinstance(metrics, dict)
    )
    fallback = (
        template_analysis(facts, state.get("chunks") or [])
        if summary and has_score
        else scene_template(state)
    )
    return {
        "valid": False,
        "issues": result["issues"],
        "validation": result["issues"],
        "text": fallback,
        "source": "template",
        "code": "invalid",
    }


def _after_classify(state: AgentState) -> str:
    intent = state.get("intent")
    if state.get("scene") == "report":
        return "generate"
    if intent == INTENT["TREND"]:
        return "retrieve" if (state.get("facts") or {}).get("trend") else "no_trend"
    if intent in {INTENT["EXPLAIN"], INTENT["SUMMARY"]}:
        return "retrieve"
    return "fixed"


def _after_retrieve(state: AgentState) -> str:
    return "generate"


def _after_validate(state: AgentState) -> str:
    # Invalid LLM output already carries the deterministic template text.
    return "end"


def _build_graph():
    builder = StateGraph(AgentState)
    builder.add_node("classify", _classify_node)
    builder.add_node("retrieve", _retrieve_node)
    builder.add_node("generate", _generate_node)
    builder.add_node("validate", _validate_node)
    builder.add_node("fixed", _fixed_node)
    builder.add_node("no_trend", _no_trend_node)
    builder.set_entry_point("classify")
    builder.add_conditional_edges(
        "classify",
        _after_classify,
        {"retrieve": "retrieve", "fixed": "fixed", "generate": "generate", "no_trend": "no_trend"},
    )
    builder.add_conditional_edges("retrieve", _after_retrieve, {"generate": "generate"})
    builder.add_edge("generate", "validate")
    builder.add_conditional_edges("validate", _after_validate, {"end": END, "fixed": "fixed"})
    builder.add_edge("fixed", END)
    builder.add_edge("no_trend", END)
    return builder.compile()


_GRAPH = _build_graph()


def answer(
    db: Session | None,
    question: str,
    facts: dict,
    history: list,
    memory: dict | None,
    scene: str = DEFAULT_SCENE,
    chunks: list | None = None,
) -> dict:
    state: AgentState = {
        "question": question,
        "facts": facts,
        "history": history,
        "memory": memory or {},
        "scene": scene,
        "chunks": chunks or [],
        "citations": [c["id"] for c in (chunks or [])],
        "sources": [
            {
                "id": c["id"],
                "title": c.get("title", ""),
                "text": c.get("text", ""),
                "source": c.get("source") or {},
            }
            for c in (chunks or [])
        ],
        "risk": "low",
    }
    token = _DB.set(db)
    try:
        result = _GRAPH.invoke(state, {"configurable": {"thread_id": "local"}})
    finally:
        _DB.reset(token)
    text = result.get("text", "")
    if result.get("source") == "llm":
        # 引用行只在校验时检查；展示统一走 citations 数组（前端已有引用行渲染）。
        text = TRAILING_CITATION_RE.sub("", text).rstrip()
    return {
        "intent": result.get("intent", INTENT["EXPLAIN"]),
        "risk": result.get("risk", "low"),
        "text": text,
        "citations": result.get("citations", []),
        "sources": result.get("sources", []),
        "source": result.get("source", "template"),
        "code": result.get("code", "ok"),
        "model": result.get("model"),
        "latency_ms": result.get("latency_ms"),
        "validation": result.get("validation") or result.get("issues") or [],
    }
