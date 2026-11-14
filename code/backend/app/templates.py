"""报告用的模板解读（无模型时的确定性兜底）。

与前端的模板方向一致：先说这次测了哪些维度，再逐项给出
「任务是什么 + 本次原始数字 + 这组数字怎么读」，然后给一两条
可以试试的建议，最后提醒局限。

措辞每次随机，事实与方向固定；不推断能力高低、不出现诊断或总分表述。
"""

from __future__ import annotations

import random

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
SUPPORT_DIMS = {"vc", "ps", "sv", "am"}

OPENINGS = [
    "这次标准档完成了 {n} 项，按维度把原始指标列一下。",
    "本次测得 {n} 个维度的原始数据，逐项如下。",
    "四项任务已完成 {n} 项，先看数据本身。",
    "下面是这次任务的原始数据，逐条对应到维度。",
]

CLOSINGS = [
    "这些数字只反映本次任务里的表现，受睡眠、情绪、设备与练习效应影响，换一天再测可能不同。",
    "分数由服务端按 scoring-v3.1 折算，仅作参考；它不是常模分数，也不与任何人比较。",
    "想细聊某一项，可以去对话页继续追问；练习建议也在那里。",
    "单次结果说明不了能力高低，把它当作一次「今天的快照」更合适。",
]

SUGGESTIONS = {
    "vc": "近义词可以成对整理，比较它们在句子里的用法差别。",
    "ps": "限时任务可以先练「确认后再作答」，减少为赶速度产生的错误。",
    "sv": "遇到旋转题先在纸上画出转完的图案，再和心里的结果对照。",
    "am": "记词对时按场景分组，回想时先想场景再想词（参考：kb-dim-am-01）。",
}
GENERAL_SUGGESTION = "把练习分散到不同日子，比一次性长时间重复更稳（参考：kb-plan-01）。"

TREND_OPENINGS = [
    "这两次都测过的维度，变化如下。",
    "只看两次都测过的维度，逐维对比。",
    "两次对比的共同维度及分数差值：",
]
TREND_CLOSINGS = [
    "差值只描述两次分数的距离，不等于训练效果；睡眠、情绪、设备与练习效应都会影响单次结果。",
    "分数只与自己的上一次比较才有意义——这里没有常模，也不与人群比较，单次波动是常态。",
    "想看稳定趋势，请保持 7 天以上的间隔多测几次；单次差值只能当作线索，不等于训练效果。",
]


def _rt(metrics: dict) -> str:
    ms = metrics.get("meanRtMs")
    if isinstance(ms, (int, float)) and ms > 0:
        return f"，平均每题反应约 {ms / 1000:.1f} 秒"
    return ""


def _facts(dim: str, metrics: dict) -> list[str]:
    correct = metrics.get("correct")
    total = metrics.get("total")
    if dim == "vc":
        return [
            f"言语理解 · 判断词语关系是否相近：{total} 题答对 {correct} 题{_rt(metrics)}",
            f"言语理解 · 词义辨析，共 {total} 题，答对 {correct} 题{_rt(metrics)}",
            f"言语理解 · 从四个近义词里选最接近的一个，{total} 题里对 {correct} 题",
        ]
    if dim == "ps":
        seconds = metrics.get("seconds")
        trials = metrics.get("trials")
        return [
            f"知觉速度 · 在 {seconds} 秒内判断符号组合是否相同：完成 {trials} 题、正确 {correct} 题",
            f"知觉速度 · {seconds} 秒计时，共作答 {trials} 题，其中正确 {correct} 题",
            f"知觉速度 · 计时 {seconds} 秒做符号匹配，得到 {trials} 次作答、{correct} 次正确",
        ]
    if dim == "sv":
        return [
            f"空间视觉化 · 判断图形旋转后是否与目标一致：{total} 题答对 {correct} 题",
            f"空间视觉化 · 图形旋转判断，{total} 题中答对 {correct} 题",
            f"空间视觉化 · 在平面里比对旋转后的图形，{total} 题对了 {correct} 题",
        ]
    hits = metrics.get("hits")
    false_alarms = metrics.get("falseAlarms")
    return [
        f"联想记忆 · 先记词对再判断是否出现过：命中 {hits} 个、虚报 {false_alarms} 个",
        f"联想记忆 · 再认判断，认对 {hits} 个、把没见过的当成见过 {false_alarms} 次",
        f"联想记忆 · 词对回忆后再认，命中 {hits}、虚报 {false_alarms}",
    ]


def _ratio(metrics: dict, top: str, bottom: str) -> float:
    part = metrics.get(top)
    whole = metrics.get(bottom)
    if isinstance(part, (int, float)) and isinstance(whole, (int, float)) and whole:
        return part / whole
    return 0.0


def _reading(dim: str, metrics: dict) -> str:
    if dim == "vc":
        ratio = _ratio(metrics, "correct", "total")
        if ratio >= 0.85:
            return "这次对的题比较多，词义判断整体顺利。"
        if ratio >= 0.6:
            return "大部分题目判断正确，难点可能落在近义词的细微差别上。"
        return "这次对的题偏少，近义词之间的细微差别可能是主要难点。"
    if dim == "ps":
        wrong = metrics.get("wrong")
        if wrong == 0:
            return "全程没有判断错误：限时任务要在快和准之间取舍，这次偏向了准。"
        return f"有 {wrong} 次判断错误：限时任务的结果同时反映速度与策略，要结合作答量一起看。"
    if dim == "sv":
        ratio = _ratio(metrics, "correct", "total")
        if ratio >= 0.9:
            return "这次没有出现判断错误，图像操作比较顺。"
        return "旋转判断有几题没对上，可以先在脑内把图转完再选。"
    false_alarms = metrics.get("falseAlarms") or 0
    if false_alarms >= 3:
        return "再认有时靠「眼熟」而不是真的记得，虚报多说明有几题被熟悉感带偏了。"
    return "虚报很少，说明这次判断更多靠「确实记得」，而不是靠眼熟。"


def _error_rate(dim: str, metrics: dict) -> float:
    if dim == "ps":
        trials = metrics.get("trials")
        wrong = metrics.get("wrong") or 0
        return wrong / trials if isinstance(trials, (int, float)) and trials else 0.0
    if dim == "am":
        hits = metrics.get("hits") or 0
        false_alarms = metrics.get("falseAlarms") or 0
        total = hits + false_alarms
        return false_alarms / total if total else 0.0
    ratio = _ratio(metrics, "correct", "total")
    return 1 - ratio if ratio else 0.0


def _weakest(measured: list[str], facts: dict) -> str:
    return max(measured, key=lambda dim: _error_rate(dim, facts[dim]))


def template_narrative(facts: dict | None) -> str:
    """生成报告用的模板解读；没有可读指标时退回一句说明。"""
    data = {k: v for k, v in (facts or {}).items() if k in SUPPORT_DIMS and isinstance(v, dict)}
    if not data:
        return "本次还没有可解读的原始指标。完成测评后会在这里给出说明。"

    rng = random.Random()
    measured = [dim for dim in DIM_ORDER if dim in data]
    lines = []
    for dim in measured:
        metrics = data[dim]
        lines.append(f"· {rng.choice(_facts(dim, metrics))}。{_reading(dim, metrics)}")

    missing = [dim for dim in DIM_ORDER if dim not in data]
    weakest = _weakest(measured, data)

    parts = [rng.choice(OPENINGS).format(n=len(measured)), *lines]
    if weakest in SUGGESTIONS:
        parts.append("")
        parts.append("可以试试：")
        parts.append(f"· {SUGGESTIONS[weakest]}")
        parts.append(f"· {GENERAL_SUGGESTION}")
    if missing:
        names = "、".join(DIM_NAMES[dim] for dim in missing)
        parts.append(f"另有 {len(missing)} 个维度（{names}）本档未测，报告里留空，不按 0 分计算。")
    parts.append("")
    parts.append(rng.choice(CLOSINGS))
    return "\n".join(parts)


def template_trend(payload: dict | None) -> str:
    """趋势解释的确定性兜底（scene="trend" 无模型/校验失败时输出）。"""
    data = payload if isinstance(payload, dict) else {}
    rows = data.get("rows") or []
    if not rows:
        return (
            "本机还没有两次可比的测评，或者两次测评没有共同测过的维度。"
            "完成一次标准测评后，这里才能解释变化。"
        )

    def fmt_delta(delta: int) -> str:
        if delta > 0:
            return f"+{delta}"
        if delta < 0:
            return str(delta)
        return "持平"

    lines = [f"· {row.get('name') or DIM_NAMES.get(row.get('id'), row.get('id'))} "
             f"{row['prev']} → {row['next']}（{fmt_delta(row['delta'])}）" for row in rows]

    skipped = [dim for dim in dict.fromkeys([*(data.get("onlyPrev") or []), *(data.get("onlyNext") or [])])]
    days = data.get("days")

    rng = random.Random()
    parts = [rng.choice(TREND_OPENINGS), *lines]
    notes = []
    if days is not None:
        if data.get("repeatRisk"):
            notes.append(f"两次间隔 {days} 天，少于 7 天，练习效应可能抬高本次结果")
        else:
            notes.append(f"两次间隔 {days} 天")
    if skipped:
        names = "、".join(DIM_NAMES.get(dim, str(dim)) for dim in skipped)
        notes.append(f"{names} 两次没有都测到，不参与对比")
    if notes:
        parts.append("；".join(notes) + "。")
    parts.append("")
    parts.append(rng.choice(TREND_CLOSINGS))
    return "\n".join(parts)
