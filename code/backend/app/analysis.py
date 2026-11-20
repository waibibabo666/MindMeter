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
    "允许的派生只有两种：毫秒除以 1000 换成秒并保留 1–2 位小数"
    "（1870 毫秒写 1.87 秒，不要写 1.873 秒），比率写成百分比并保留 1 位小数"
    "（5/8 写 62.5%）；除此之外不要出现任何别的数字。"
    "数字一律用阿拉伯数字书写，不要写「两分五十秒」这类中文时间读法，"
    "也不要把毫秒换算成分或小时（2500 毫秒只能写 2500 毫秒或 2.5 秒）。"
    "2）给 2 条具体、可执行的日常建议，说明针对哪个维度；"
    "建议用编号列表给出，每条写成「短标题：具体怎么做」（例如「1. 睡眠与休息：保证充足睡眠」）；"
    "建议只写日常能做的行为：睡眠与休息、把练习分散到不同日子、环境与注意力、记录与复测；"
    "不要建议刷同类测评题、做题技巧或应试策略；知识块里的任务说明只用于解释“测什么”，不能直接当建议。"
    "3）末尾另起一行写「引用：<真实编号> · <真实标题>」："
    "编号与标题都要逐字取自下面列出的知识块，不要编造编号，"
    "也严禁把“知识块编号”“知识块标题”这些说明文字抄进回答。"
    "不推断能力高低，不下诊断，不与人群比较，不提总分、百分位或正常/异常。"
    "不得给指标编造材料里没有的认知机制（“属于目标符号本身错误”“可能存在混淆”"
    "“回忆效率/编码质量有待提升”这类都不行），只陈述数值本身与任务条件。"
    "不得给出等级、好差、强弱的判断（“表现中等”“水平较高”“能力较弱”“优秀”“良好”都禁），"
    "褒义的评级同样禁止；只描述任务条件与原始数字。"
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
        # 只把"真的有值"的字段给模型：None/空值喂进去就会被抄进中文回答。
        compact = {
            key: value
            for key, value in metrics.items()
            if key != "score" and value is not None and value != "" and value != []
        }
        if not compact and "无可用参考分" in score_text:
            continue
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
    if chunks:
        # 引用行的真实编号来源（和 chat 侧同源）：逐条给出「引用：编号 · 标题」，
        # 不写出来模型就会抄占位说明。
        user.extend(
            [
                "",
                "引用行请照抄下面任意一行（原样保留编号与标题，不要自己写编号，"
                "也不要把「知识块编号」「标题」这些说明词抄进回答）：\n"
                + "\n".join(
                    f"引用：{chunk.get('id')} · {chunk.get('title', '')}".rstrip(" ·")
                    for chunk in chunks[:3]
                ),
            ]
        )
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
