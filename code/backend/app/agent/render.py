"""确定性渲染与 prompt 拼装。"""
from __future__ import annotations

from ..analysis import DIM_NAMES, DIM_ORDER, SPECIFIC_SUGGESTIONS
from ..analysis import build_messages as build_analysis_messages
from ..analysis import retrieve_context, template_analysis, weak_dims
from ..templates import metric_clauses, reading_sentence, template_narrative, template_trend
from .classify import DIM_MEASURES, dims_in_question, is_advice_ask, is_explain_what_ask
from .policies import DEFAULT_SCENE, prompt_for
from .validation import SCORING_NOTE
def _readable_facts(facts: dict) -> dict:
    """只看真能解读的维度（有至少一个可读原始字段），trend 键不算结果数据。"""
    return {
        dim: metrics
        for dim, metrics in (facts or {}).items()
        if dim in DIM_NAMES and isinstance(metrics, dict) and metric_clauses(dim, metrics)
    }


def template_explanation(facts: dict, question: str = "", chunk_ids: set[str] | None = None) -> str:
    """对话页的确定性兜底：按"用户问的是什么"给内容，而不是永远吐一份指标清单。

    两条硬性纪律：
      * 只复述**取到的**字段（`templates.metric_clauses`），取不到的整句跳过 ——
        用户实测到的「知觉速度 None 秒内完成 None 题、正确 14」就是旧版硬拼
        `seconds`/`trials` 造成的，新版 ps 上报的是 enc*/cat*；
      * 问"建议/下一步/明天测什么"时给可执行建议（带真实引用），
        而不是把四项指标重列一遍。
    """
    data = _readable_facts(facts or {})
    asked = dims_in_question(str(question or ""))
    advice_ask = is_advice_ask(str(question or ""))
    citations = chunk_ids or set()

    focus = [dim for dim in DIM_ORDER if dim in data and (not asked or dim in asked)]
    lines = []
    for dim in focus:
        clauses = metric_clauses(dim, data[dim])
        if clauses:
            lines.append(f"· {DIM_NAMES[dim]}：" + "；".join(clauses))

    if not lines:
        return (
            "本次还没有可解读的原始指标（这一档没有留下可读的作答记录）。"
            "完成一次测评后，这里才能针对具体维度解释数字怎么读、下一步怎么做。"
        )

    parts: list[str] = []
    if is_explain_what_ask(str(question or "")) and not advice_ask:
        # 「这项测什么」→ 先讲任务形式，再给本次数字；不给练习建议。
        # 但如果同时含「建议/下一步/明天」这类诉求（"我明天建议测什么"），
        # 仍然按建议走——那是在问下一步做什么。
        targets = asked or focus
        explained = [
            f"{DIM_NAMES[dim]}测的是{DIM_MEASURES[dim]}"
            for dim in targets
            if dim in DIM_MEASURES
        ]
        if explained:
            parts.append("；".join(explained) + "。")
            parts.append("")
        parts.append("本次相关维度的记录是：")
        parts.extend(lines)
    elif advice_ask:
        targets = asked or weak_dims(data) or focus
        parts.append("下一步可以这样安排：")
        for dim in targets[:2]:
            tip, source_id = SPECIFIC_SUGGESTIONS.get(dim, (None, None))
            if not tip:
                continue
            tail = f"（引用：{source_id}）" if source_id in citations else ""
            parts.append(f"· {DIM_NAMES[dim]} · {tip}{tail}")
        plan_ids = sorted(citation for citation in citations if citation.startswith("kb-plan"))
        if plan_ids:
            parts.append(f"· 练习分散到不同日子，比一次性长时间重复更稳（引用：{plan_ids[0]}）。")
        parts.append(
            "· 想看到可比的变化，请隔一周以上再复测同一档位；"
            "间隔太短，练习效应会让差值不好解释。"
        )
        parts.append("")
        parts.append("这次相关维度的原始数字是：")
        parts.extend(lines)
    elif asked:
        if len(asked) == 1:
            parts.append(f"你问的是{DIM_NAMES[asked[0]]}，本次该项的记录是：")
        else:
            parts.append("你问的是" + "、".join(DIM_NAMES[dim] for dim in asked) + "，本次这几项的记录是：")
        parts.extend(lines)
        parts.append("")
        for dim in asked:
            if dim in data:
                parts.append(f"怎么读：{reading_sentence(dim, data[dim])}")
        tip, source_id = SPECIFIC_SUGGESTIONS.get(asked[0], (None, None))
        if tip:
            tail = f"（引用：{source_id}）" if source_id in citations else ""
            parts.append("可以试试：")
            parts.append(f"· {tip}{tail}")
    else:
        parts.append("本次完成的原始指标：")
        parts.extend(lines)
        parts.append("")
        parts.append("想细看某一项，可以直接说出维度名，比如「联想记忆为什么低」「知觉速度怎么练」。")

    parts.append("")
    parts.append("这些只是本次测得的原始数据，不是分数，也不与人群比较。")
    parts.append(SCORING_NOTE)
    return "\n".join(parts)


def scene_template(state: dict) -> str:
    """按场景的确定性兜底（任何降级都不会输出空白）。"""
    scene = state.get("scene") or DEFAULT_SCENE
    facts = state.get("facts") or {}
    if scene == "report":
        return template_narrative(facts)
    if scene == "trend":
        return template_trend(facts.get("trend") or {})
    if scene == "summary":
        return template_analysis(facts, state.get("chunks") or [])
    return template_explanation(
        facts,
        str(state.get("question") or ""),
        {str(chunk.get("id") or "") for chunk in (state.get("chunks") or [])},
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
        lines.append("最近一条记忆摘要：" + str(memory["summaryText"]))
    advice = memory.get("advice") or []
    if advice:
        shown = "、".join(
            "「{}」{}{}".format(
                str(item.get("title") or item.get("id") or "")[:30],
                "（已完成）" if item.get("done") else "（未完成）",
                "" if item.get("title") else f"（编号 {item.get('id')}）",
            )
            for item in advice
        )
        lines.append(f"已给过的建议：{shown}。不要原样重复，可在其基础上递进。")
    return lines


def _facts_line(facts: dict) -> str:
    """给模型的本次指标一行一维，**行首带中文维度名**。

    两点实测依据：
      * 缺测字段（None / 空串 / 嵌套空列表）在这里就剔掉：把 `{'seconds': None}` 原样
        喂给模型，模型就会把 None 抄进中文回答（用户实测的「知觉速度 None 秒」有一半是
        这么来的）。数字仍然只来自 facts，校验白名单口径不变。
      * 旧版只写 `am: {...}` 这种英文短码，模型要自己猜"am=联想记忆"，实测就会把
        ps 的 12/2/1880 抄进"联想记忆"那句里（数字都在 facts 里，白名单拦不住，
        但结论已经错了）。行首给中文维度名，和 `dimension_score_owners` 用的
        同一套名字，模型与校验器口径一致。
    """
    parts = []
    for key, value in (facts or {}).items():
        if key == "trend":
            continue
        label = f"{DIM_NAMES[key]}（{key}）" if key in DIM_NAMES else key
        if isinstance(value, dict):
            clean = {
                metric: reading
                for metric, reading in value.items()
                if reading is not None and reading != "" and reading != []
            }
            if clean:
                parts.append(f"{label}: {clean}")
        elif value is not None and value != "" and value != []:
            parts.append(f"{label}: {value}")
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
    if chunks:
        # 引用行照抄这一行：把本轮真实存在的编号 · 标题逐条给出来。
        # 只写"知识块编号 · 标题"这种抽象说明，模型会把它当字面内容抄进回答
        # （2026-11-20 实测输出「引用：知识块编号 · 标题」）。
        blocks.append(
            "引用行请照抄下面任意一行（原样保留编号与标题，不要自己写编号，"
            "也不要把「知识块编号」「标题」这些说明词抄进回答）：\n"
            + "\n".join(
                f"引用：{chunk.get('id')} · {chunk.get('title', '')}".rstrip(" ·") for chunk in chunks[:3]
            )
        )
    if isinstance(facts, dict) and facts.get("trend"):
        blocks.append(_trend_block(facts["trend"]))
    extra = memory_lines(memory)
    if extra:
        blocks.append("用户背景（只用于调整表述，不作为数字来源）：\n" + "\n".join(extra))
    blocks.append("用户问题：" + question)
    # 时序修正：旧对话在前，当前问题在最后（此前把 history 拼在问题之后）。
    return [{"role": "system", "content": prompt_for(scene)}, *prior, {"role": "user", "content": "\n\n".join(blocks)}]

