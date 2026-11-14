"""Shared result analysis: facts + reviewed knowledge + concrete suggestions."""
from __future__ import annotations

import json

from sqlalchemy.orm import Session

from .rag import retrieve

DIM_NAMES = {
    "vc": "言语理解",
    "vf": "言语流畅性",
    "nc": "数字运算",
    "ps": "知觉速度",
    "ir": "归纳推理",
    "sv": "空间视觉化",
    "am": "联想记忆",
    "ni": "自然探索",
}
DIM_ORDER = ["vc", "vf", "nc", "ps", "ir", "sv", "am", "ni"]

ANALYSIS_PROMPT = (
    "你是 MindMeter 的解读助手。根据本次原始指标和给定知识块，输出三部分："
    "1）用 2–3 句话解读本次结果，只使用给定数字；"
    "2）给 2 条具体、可执行的日常建议，说明针对哪个维度；"
    "建议只写日常能做的行为：睡眠与休息、把练习分散到不同日子、环境与注意力、记录与复测；"
    "不要建议刷同类测评题、做题技巧或应试策略；知识块里的任务说明只用于解释“测什么”，不能直接当建议。"
    "3）末尾另起一行写「引用：知识块编号 · 标题」。"
    "不推断能力高低，不下诊断，不与人群比较，不提总分、百分位或正常/异常。"
    "总长不超过 700 字。"
)

SPECIFIC_SUGGESTIONS = {
    "vc": ("把近义词放进真实句子或文章里比较用法，比单独背词表更接近日常使用。", "kb-dim-vc-02"),
    "ps": ("需要快速判断时先把准确放在速度前面；把练习分散到不同日子，避免一次长时间重复。", "kb-plan-01"),
    "sv": ("用拼图、地图或收纳等空间活动练习在脑中旋转物体，不必反复刷同类测评题。", "kb-dim-sv-02"),
    "am": ("把要记的内容编成场景或故事，隔一天再回忆一次，重点区分“确实见过”和“只是眼熟”。", "kb-dim-am-01"),
    "nc": ("把连续运算拆成小步并记录中间结果，日常用估算检查答案。", "kb-task-nc-01"),
    "ir": ("遇到规律题先写下假设，再用第二组数据验证，不凭第一眼。", "kb-task-ir-01"),
    "ni": ("把新知识按主题连接到已有知识，比较相邻概念的差异。", "kb-task-ni-01"),
    "vf": ("把同类词练习分散到不同日子，避免一次长时间重复。", "kb-plan-01"),
}


def measured(facts: dict) -> list[tuple[str, int]]:
    items = []
    for dim in DIM_ORDER:
        metrics = facts.get(dim) if isinstance(facts, dict) else None
        if not isinstance(metrics, dict):
            continue
        score = metrics.get("score")
        if isinstance(score, int):
            items.append((dim, score))
    return items


def weak_dims(facts: dict, limit: int = 2) -> list[str]:
    items = measured(facts)
    return [dim for dim, _ in sorted(items, key=lambda pair: pair[1])[:limit]]


def strong_dims(facts: dict, limit: int = 1) -> list[str]:
    items = measured(facts)
    return [dim for dim, _ in sorted(items, key=lambda pair: pair[1], reverse=True)[:limit]]


def facts_block(facts: dict) -> str:
    lines = []
    for dim in DIM_ORDER:
        metrics = facts.get(dim) if isinstance(facts, dict) else None
        if not isinstance(metrics, dict):
            continue
        score = metrics.get("score")
        score_text = f"参考分 {score}" if isinstance(score, int) else "无可用参考分"
        compact = {k: v for k, v in metrics.items() if k != "score"}
        lines.append(
            f"- {DIM_NAMES[dim]}（{dim}）：{score_text}；原始指标 "
            + json.dumps(compact, ensure_ascii=False)
        )
    return "\n".join(lines) or "（本次没有可解读的指标）"


def retrieve_context(db: Session, facts: dict, limit: int = 8) -> list[dict]:
    weak = weak_dims(facts)
    queries = []
    for dim in weak:
        queries.extend([f"{DIM_NAMES[dim]} 怎么练", f"{DIM_NAMES[dim]} 测什么"])
    extra = {
        "vc": "近义词 成对 整理",
        "ps": "限时任务 策略 正确 速度",
        "sv": "心理旋转 练习",
        "am": "词对 场景 分组",
        "nc": "运算 拆成 小步",
        "ir": "行 列 规律 验证",
        "ni": "自然知识 分类",
        "vf": "同类词 分散 练习",
    }
    queries += [extra[dim] for dim in weak if dim in extra]
    queries += [f"{DIM_NAMES[dim]} 分数怎么读" for dim in weak[:1]]
    queries += ["练习效应", "睡眠会影响成绩吗", "复测怎么比较", "未测是什么意思"]
    found: dict[str, dict] = {}
    for query in queries:
        for chunk in retrieve(db, query, limit=2):
            found.setdefault(chunk["id"], chunk)
    priority = {"dim": 0, "task": 1, "plan": 2, "factor": 3, "score": 4}

    def rank(chunk: dict) -> tuple[int, float]:
        parts = str(chunk.get("id", "")).split("-")
        kind = parts[1] if len(parts) > 1 else ""
        return priority.get(kind, 9), -float(chunk.get("score", 0))

    ordered = sorted(found.values(), key=rank)
    return ordered[:limit]


def build_messages(facts: dict, chunks: list[dict], question: str | None = None) -> list[dict]:
    kb = "\n".join(f"{c['id']} · {c['title']}：{c['text']}" for c in chunks) or "（无）"
    user = [
        "本次原始指标：",
        facts_block(facts),
        "",
        "可引用知识块：",
        kb,
    ]
    if question:
        user.extend(["", f"用户问题：{question}"])
    return [
        {"role": "system", "content": ANALYSIS_PROMPT},
        {"role": "user", "content": "\n".join(user)},
    ]


def template_analysis(facts: dict, chunks: list[dict]) -> str:
    items = measured(facts)
    if not items:
        return "本次还没有可解读的参考分。先完成一次测评，我会按维度和知识库给你具体建议。"
    weak = weak_dims(facts)
    strong = strong_dims(facts)
    lines = [
        f"本次有 {len(items)} 个维度有参考分。"
        + (f"相对较高的是 {DIM_NAMES[strong[0]]}（{dict(items)[strong[0]]}）。" if strong else "")
        + (f"可以关注 {('、'.join(DIM_NAMES[d] for d in weak))}。" if weak else ""),
    ]
    citations = []
    suggestions = []
    for dim in weak[:2]:
        text, source_id = SPECIFIC_SUGGESTIONS.get(dim, (None, None))
        if text:
            chunk_ids = {c["id"] for c in chunks}
            if source_id in chunk_ids:
                suggestions.append(f"· {text}（引用：{source_id}）")
                citations.append(source_id)
            else:
                suggestions.append(f"· {text}")
    for chunk in chunks:
        if chunk["id"].startswith("kb-plan") and chunk["id"] not in citations:
            suggestions.append(f"· 练习分散到不同日子，避免一次性长时间重复（引用：{chunk['id']}）。")
            citations.append(chunk["id"])
            break
    for chunk in chunks:
        if chunk["id"].startswith("kb-factor") and chunk["id"] not in citations:
            suggestions.append(f"· 睡眠不足或疲劳会拉低速度类表现，先休息后复测（引用：{chunk['id']}）。")
            citations.append(chunk["id"])
            break
    if suggestions:
        lines.extend(["", "可以试试：", *suggestions[:3]])
    if citations:
        lines.extend(["", "引用：" + " · ".join(dict.fromkeys(citations))])
    lines.append("")
    lines.append("分数只反映本次任务，不是常模或诊断；单次差异不等于能力变化。")
    return "\n".join(lines)
