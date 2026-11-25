"""LangGraph orchestration: nodes, edges, and the public ``answer()``."""
from __future__ import annotations

import time
from typing import Any

from langgraph.graph import END, StateGraph

from ..analysis import DIM_NAMES, DIM_ORDER, SPECIFIC_SUGGESTIONS
from ..analysis import build_messages as build_analysis_messages
from ..analysis import retrieve_context, template_analysis, weak_dims
from ..config import settings
from ..llm import LLMError, call_llm_with_fallback, site_llm_config
from ..rag import retrieve as retrieve_kb
from ..templates import metric_clauses, reading_sentence, template_narrative, template_trend
from .classify import (
    DIMENSION_WORDS,
    DIM_MEASURES,
    DOMAIN_WORDS,
    FIXED_REPLY,
    GREETING_NO_FACTS,
    INTENT,
    NO_KNOWLEDGE_REPLY,
    RISK_BY_INTENT,
    SCOPE_BACKFILL,
    classify,
    dims_in_question,
    fixed_reply,
    is_advice_ask,
    is_explain_what_ask,
    needs_llm_fallback,
    resolve_intent,
)
from .intent_llm import classify_with_llm
from .misconceptions import build_correction, should_correct
from .policies import DEFAULT_SCENE, policy_for, prompt_for
from .render import _facts_line, _readable_facts, build_messages, scene_template, template_explanation
from .state import AgentState
from .structured import STRUCTURED_INSTRUCTION, parse_structured
from .validation import (
    ABSOLUTE_CLAIM_RE,
    TRAILING_CITATION_RE,
    derived_allowed_numbers,
    dimension_score_owners,
    has_positive_correct,
    repair_rating_wording,
    validate_text,
)
def _classify_node(state: AgentState) -> dict:
    if state.get("scene") == "report":
        return {"intent": INTENT["EXPLAIN"], "risk": "low", "matched": [], "intentSource": "scene"}
    keyword = classify(state.get("question", ""))
    intent, source = keyword["intent"], "rule"
    matched = list(keyword["matched"])

    # 关键词拿不准时才问模型（危机/越界等安全意图根本不会走到这里）。
    if needs_llm_fallback(keyword):
        facts = state.get("facts") or {}
        # 维度读数与趋势是两份不同的数据：有趋势不代表有本次结果，反之亦然。
        has_dims = any(dim != "trend" and isinstance(value, dict) for dim, value in facts.items())
        llm_intent = classify_with_llm(state.get("question", ""), state.get("history"))
        intent, source = resolve_intent(
            keyword,
            llm_intent,
            has_facts=has_dims,
            has_trend=isinstance(facts.get("trend"), dict),
        )
        if source == "llm":
            matched = [f"llm:{intent}"]

    # TREND 意图自动切换 scene，让校验与模板走趋势策略；其余保持入口 scene。
    update: dict = {
        "intent": intent,
        "risk": RISK_BY_INTENT.get(intent, "low"),
        "matched": matched,
        "intentSource": source,
    }
    if intent == INTENT["TREND"]:
        update["scene"] = "trend"
    if intent == INTENT["SUMMARY"]:
        update["scene"] = "summary"
    return update


def _retrieve_node(state: AgentState) -> dict:
    db = state.get("db")
    if db is None:
        return {"chunks": []}
    if state.get("intent") == INTENT["SUMMARY"]:
        chunks = retrieve_context(
        db, state.get("facts") or {}, limit=8, question=str(state.get("question") or "")
    )
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
    text = fixed_reply(intent)
    if intent == INTENT["GREETING"] and not _readable_facts(state.get("facts") or {}):
        # 还没有任何可解读结果时，寒暄必须先把能力边界说清（A1），
        # 而不是抛一句"你可以问你的认知怎么样"却根本不答得出来。
        text = GREETING_NO_FACTS
    return {
        "text": text,
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
    db = state.get("db")
    fallback = template_analysis(facts, chunks) if summary else scene_template(state)
    if db is None:
        return {"text": fallback, "source": "template", "code": "unknown"}
    config = site_llm_config()
    if not config.enabled:
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
                state.get("memory") if settings.memory_in_prompt else None,
                scene,
            )
        )
        if settings.llm_structured:
            # 结构化输出：在 system 里追加 JSON 约束；解析失败自动回退纯文本。
            messages = [
                *messages,
                {"role": "system", "content": STRUCTURED_INSTRUCTION},
            ]
        reply = call_llm_with_fallback(
            config,
            messages,
            max_tokens=3000 if summary else settings.llm_max_tokens,
        )
        latency = int((time.monotonic() - started) * 1000)
        text = reply.text
        if settings.llm_structured:
            parsed = parse_structured(
                reply.text, [str(chunk.get("id") or "") for chunk in chunks]
            )
            if parsed:
                text = parsed["text"]
        return {"text": text, "source": "llm", "code": "ok", "model": reply.model, "latency_ms": latency}
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
    chunks = state.get("chunks") or []
    if not chunks:
        # 知识块为空时不要求引用（facts-only 回答是合法分级，见 §3 RAG 行）。
        rule["require_citation"] = "off"
    allowed_numbers = derived_allowed_numbers(state.get("facts"))
    score_owners = dimension_score_owners(state.get("facts"))
    chunk_ids = {str(chunk.get("id") or "") for chunk in chunks if chunk.get("id")} or None
    result = validate_text(
        state.get("text", ""),
        allowed_numbers=allowed_numbers,
        policy=rule,
        score_owners=score_owners,
        chunk_ids=chunk_ids,
    )
    # 绝对化表述校验：事实里有答对项，却写「全部错误/完全不会」→ 硬失败，走模板。
    # 真实模型实测把「知觉速度错了 3 题」写成「全部错误」，这类失真必须拦。
    if ABSOLUTE_CLAIM_RE.search(state.get("text", "")) and has_positive_correct(
        state.get("facts")
    ):
        result = {
            "ok": False,
            "issues": [
                *result["issues"],
                {
                    "code": "absolute_claim",
                    "detail": "出现「全部错误/完全不会」等绝对化描述，但原始指标里有答对项",
                    "severity": "hard",
                },
            ],
            "chars": len(state.get("text", "")),
        }
    if result["ok"]:
        soft = [issue["code"] for issue in result["issues"] if issue["severity"] == "soft"]
        issues = list(result["issues"])
        text = state.get("text", "")
        # 边界声明是产品底线，不该因为模型漏写就让用户看到没有声明的回答：
        # 这里直接补写固定声明，并把该 soft 问题标记为已修复（其余 soft 仍上报）。
        if "scope_note_missing" in soft:
            text = f"{text.rstrip()}\n\n{SCOPE_BACKFILL}".strip()
            issues = [issue for issue in issues if issue["code"] != "scope_note_missing"]
            soft = [code for code in soft if code != "scope_note_missing"]
        out: dict = {
            "valid": True,
            "text": text,
            "issues": issues,
            "validation": issues,
        }
        if soft:
            out["code"] = soft[0]
        return out
    hard = [issue for issue in result["issues"] if issue["severity"] == "hard"]
    # 缺陷**只在措辞**（能力评级词）时：改写措辞后重新校验，而不是把整份内容扔掉。
    # 第 3 轮实测「我哪方面比较强」4/4 次被「表现较好」判死 → 这个问题永远看不到模型答案。
    # 红线是"Agent 只能错措辞，不能错分数/结论"：能改对措辞就该留下内容。
    # 数字无依据、跨维度、机制编造、临床词都不参与改写 —— 那些不是措辞问题。
    if hard and all(str(issue.get("detail", "")).startswith("出现能力评级措辞") for issue in hard):
        repaired = repair_rating_wording(state.get("text", ""))
        if repaired != state.get("text", ""):
            retry = validate_text(
                repaired,
                allowed_numbers=allowed_numbers,
                policy=rule,
                score_owners=score_owners,
                chunk_ids=chunk_ids,
            )
            if retry["ok"]:
                issues = list(retry["issues"])
                issues.append(
                    {"code": "wording_repaired", "detail": "已把评级措辞改写为中性表述", "severity": "soft"}
                )
                soft = [issue["code"] for issue in issues if issue["severity"] == "soft"]
                # code 固定报 wording_repaired：改写这件事比"缺引用"更有调教价值，
                # 其余 soft 问题（citation_missing 等）仍完整留在 validation 里。
                return {
                    "valid": True,
                    "text": repaired,
                    "issues": issues,
                    "validation": issues,
                    "code": "wording_repaired",
                    "repaired": True,
                    "softCodes": soft,
                }
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
    # code 必须是**第一个 hard issue 的真实 code**（too_long / banned_word /
    # unsourced_number / score_misattributed / empty）。之前一律写死 "invalid"，
    # 用户和前端都看不到"为什么被回退"，调教时也丢掉了最有价值的一条线索。
    # 其余 issue（含同一条的更多细节）留在 validation 里给前端与 AIRun 遥测。
    return {
        "valid": False,
        "issues": result["issues"],
        "validation": result["issues"],
        "text": fallback,
        "source": "template",
        "code": str(hard[0]["code"]) if hard else "invalid",
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
        "db": db,
    }
    # 概念纠偏：命中常见误解时给一句确定性纠正，直接返回，不调用模型。
    # 次数上限写在 misconceptions 模块里（一次对话最多 2 次）。
    if scene == DEFAULT_SCENE:
        correction = should_correct(question, history)
        if correction:
            reply, kb_id = correction
            return {
                "intent": INTENT["EXPLAIN"],
                "intentSource": "rule",
                "risk": "low",
                "text": build_correction(reply, kb_id),
                "citations": [kb_id],
                "sources": [],
                "source": "template",
                "code": "correction",
            }
    result = _GRAPH.invoke(state, {"configurable": {"thread_id": "local"}})
    text = result.get("text", "")
    if result.get("source") == "llm":
        # 引用行只在校验时检查；展示统一走 citations 数组（前端已有引用行渲染）。
        text = TRAILING_CITATION_RE.sub("", text).rstrip()
    return {
        "intent": result.get("intent", INTENT["EXPLAIN"]),
        "intentSource": result.get("intentSource", "rule"),
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
