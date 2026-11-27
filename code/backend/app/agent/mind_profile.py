"""心智画像：把本次指标与趋势确定性地翻译成「有依据的心智描述」。

为什么单独一层：此前 prompt 只许模型"陈述数值本身"，于是回答只剩分数和模板。
这里改成**代码先写出有依据的描述，模型只负责组织语言**：

* 每一条描述都能回到 facts 里的某个数字或某个比较（谁高谁低、快准取舍、重试多少）；
* 描述里出现的数字只用 facts 里已有的参考分，校验白名单不用改；
* 只描述"这次任务里呈现出的倾向"，不下诊断、不换算量表、不与人群比较。
"""
from __future__ import annotations

from typing import Any

from ..templates import DIM_NAMES, DIM_ORDER

# 维度归到四个"心智侧面"，用来写跨维度的整体形态。
FACETS: dict[str, tuple[str, list[str]]] = {
    "language": ("语言与知识", ["vc", "vf", "ni"]),
    "reasoning": ("数理与推理", ["nc", "ir"]),
    "perceptual": ("速度与空间", ["ps", "sv"]),
    "memory": ("记忆", ["am"]),
}

# 每个维度"测的是什么"的一句话，给描述当主语（任务条件，不是能力定级）。
DIM_FOCUS = {
    "vc": "词义辨析与近义判断",
    "vf": "在限时里提取词汇",
    "nc": "连续心算与数字处理",
    "ps": "限时下的符号编码与分类",
    "ir": "从例子里归纳规则",
    "sv": "在脑中旋转与比对图形",
    "am": "把图案与位置配成对并记住",
    "ni": "调用已有的自然常识",
}

SPREAD_NOTABLE = 15  # 最高与最低参考分差到这个值才谈"形态不均衡"


def _num(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _scores(facts: dict) -> dict[str, int]:
    return {
        dim: int(metrics["score"])
        for dim in DIM_ORDER
        for metrics in [facts.get(dim)]
        if isinstance(metrics, dict) and isinstance(metrics.get("score"), int)
    }


def _style_note(dim: str, metrics: dict) -> str | None:
    """从原始指标里读"作答风格"。只写读数直接支撑的倾向。"""
    if dim == "ps":
        wrong = (_num(metrics.get("encWrong")) or 0) + (_num(metrics.get("catWrong")) or 0)
        has_any = any(_num(metrics.get(k)) is not None for k in ("encWrong", "catWrong"))
        if not has_any:
            return None
        if wrong == 0:
            return "限时里全程没有判断错误，取舍上偏向「先准再快」"
        return f"限时里出现了 {int(wrong)} 次判断错误，取舍上偏向「抢速度」，准确度被让出了一部分"
    if dim == "am":
        retries = _num(metrics.get("errors"))
        if retries is None:
            retries = _num(metrics.get("falseAlarms"))
        targets = _num(metrics.get("targets"))
        first = _num(metrics.get("firstTry"))
        if retries is None:
            return None
        if retries >= 3:
            tail = f"（一次点对 {int(first)}/{int(targets)} 组）" if first is not None and targets else ""
            return f"配对更多靠重试修正，一次就记牢的比例偏低{tail}"
        return "配对大多一次就对上，对「图案—位置」的绑定比较稳"
    if dim == "sv":
        correct, total = _num(metrics.get("correct")), _num(metrics.get("total"))
        weighted = _num(metrics.get("weighted"))
        if correct is not None and total and weighted is not None and weighted < correct:
            return "答对的题里有一部分需要多次转动才定下来，脑内旋转还不够一步到位"
    return None


def _band(score: int, mean: float) -> str:
    gap = score - mean
    if gap >= 8:
        return "在你这次的八个维度里相对突出"
    if gap <= -8:
        return "在你这次的维度里相对靠后"
    return "和你自己的整体水准接近"


def build_mind_profile(facts: dict | None) -> dict:
    """返回 `{headline, lines, facets, strengths, gaps, styles}`；没有参考分时 lines 为空。

    `lines` 是可以直接给用户或给模型的"已核实描述"，每条一句。
    """
    facts = facts if isinstance(facts, dict) else {}
    scores = _scores(facts)
    if not scores:
        return {"headline": "", "lines": [], "facets": [], "strengths": [], "gaps": [], "styles": {}}

    mean = sum(scores.values()) / len(scores)
    ordered = sorted(scores.items(), key=lambda pair: pair[1], reverse=True)
    top_dim, top_score = ordered[0]
    low_dim, low_score = ordered[-1]

    lines: list[str] = []
    styles: dict[str, str] = {}
    strengths = [d for d, s in ordered if s - mean >= 8]
    gaps = [d for d, s in reversed(ordered) if s - mean <= -8]

    # 1) 整体形态：只在有至少两个维度时才谈高低。
    if len(scores) >= 2:
        if top_score - low_score >= SPREAD_NOTABLE:
            lines.append(
                f"这次你的形态不算平均：{DIM_NAMES[top_dim]}（参考分 {top_score}）最突出，"
                f"{DIM_NAMES[low_dim]}（参考分 {low_score}）相对靠后，两者拉开了一段距离。"
            )
        else:
            lines.append("这次各个维度的参考分比较接近，没有特别突出或特别靠后的一项，整体偏均衡。")

    # 2) 心智侧面：同一侧面里的维度一起看。
    facet_rows: list[dict] = []
    for key, (label, dims) in FACETS.items():
        present = [d for d in dims if d in scores]
        if not present:
            continue
        avg = sum(scores[d] for d in present) / len(present)
        facet_rows.append({"id": key, "name": label, "dims": present, "mean": round(avg, 1)})
    if len(facet_rows) >= 2:
        best = max(facet_rows, key=lambda r: r["mean"])
        worst = min(facet_rows, key=lambda r: r["mean"])
        if best["mean"] - worst["mean"] >= SPREAD_NOTABLE and best["id"] != worst["id"]:
            lines.append(
                f"按心智侧面看，「{best['name']}」这一侧这次更顺，"
                f"「{worst['name']}」这一侧更费力，可以优先从后者找下一步。"
            )

    # 3) 逐维：只给相对突出/靠后的维度写一句具体解读（含作答风格），避免八条流水账。
    for dim in [*strengths[:2], *gaps[:2]]:
        metrics = facts.get(dim) or {}
        note = _style_note(dim, metrics)
        styles_text = f"；{note}" if note else ""
        lines.append(
            f"{DIM_NAMES[dim]}（{DIM_FOCUS[dim]}，参考分 {scores[dim]}）{_band(scores[dim], mean)}{styles_text}。"
        )
        if note:
            styles[dim] = note
    for dim in scores:
        if dim not in styles:
            note = _style_note(dim, facts.get(dim) or {})
            if note:
                styles[dim] = note

    # 4) 与上次相比（有趋势才写）。
    trend = facts.get("trend") if isinstance(facts.get("trend"), dict) else None
    if trend and trend.get("rows"):
        rows = trend["rows"]
        moved = max(rows, key=lambda r: abs(r["delta"]))
        if abs(moved["delta"]) >= 5:
            direction = "上升" if moved["delta"] > 0 else "下降"
            lines.append(
                f"和上一次相比，变化最大的是{DIM_NAMES.get(moved['id'], moved['id'])}"
                f"（{moved['prev']} → {moved['next']}，{direction} {abs(moved['delta'])}）。"
                + ("两次间隔较短，练习效应可能参与其中，多测几次再看是否稳定。" if trend.get("repeatRisk") else "")
            )
        else:
            lines.append("和上一次相比，各个共同维度的参考分变化都不大，整体形态比较稳定。")

    headline = (
        f"这次最突出的是{DIM_NAMES[top_dim]}，相对靠后的是{DIM_NAMES[low_dim]}"
        if top_score - low_score >= SPREAD_NOTABLE
        else "这次各维度整体偏均衡"
    )
    return {
        "headline": headline,
        "lines": lines,
        "facets": facet_rows,
        "strengths": strengths,
        "gaps": gaps,
        "styles": styles,
    }


def profile_block(facts: dict | None) -> str:
    """给模型的"已核实心智画像"文本块；没有内容返回空串。"""
    profile = build_mind_profile(facts)
    if not profile["lines"]:
        return ""
    return "已核实的心智画像（由本次数据按规则得出，可直接作为回答的依据，不要自行添加这里没有的结论）：\n" + "\n".join(
        f"· {line}" for line in profile["lines"]
    )
