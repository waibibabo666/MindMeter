"""报告用的模板解读（无模型时的确定性兜底）。

与前端的模板方向一致：先说这次测了哪些维度，再逐项给出
「任务是什么 + 本次原始数字 + 这组数字怎么读」，然后给一两条
可以试试的建议，最后提醒局限。

措辞每次随机，事实与方向固定；不推断能力高低、不出现诊断或总分表述。
"""

from __future__ import annotations

import math
import random

from .scoring import SCORING_VERSION

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
    f"分数由服务端按 {SCORING_VERSION} 折算，仅作参考；它不是常模分数，也不与任何人比较。",
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


def _num(value: object) -> float | None:
    """Only real numbers count as data; None/strings/bools/NaN are 缺测."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        return number if math.isfinite(number) else None
    return None


def _fmt(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else f"{value:.1f}"


def metric_clauses(dim: str, metrics: dict | None) -> list[str]:
    """把一次任务实际上报的字段翻成人话子句。

    这里是"回答不满意"里最刺眼的一条 bug 的修法：旧版按 `seconds`/`trials` 硬拼，
    而新版知觉速度上报的是 `encCorrect/encWrong/catCorrect/catWrong`，于是用户看到
    「知觉速度 None 秒内完成 None 题、正确 14」。**取不到的字段整条子句跳过**，
    任何用户可见文案里都不允许出现 None/null。
    """
    data = metrics if isinstance(metrics, dict) else {}
    clauses: list[str] = []

    seconds = _num(data.get("seconds"))
    if seconds is not None and seconds > 0:
        clauses.append(f"限时 {_fmt(seconds)} 秒")

    if dim == "ps":
        enc_correct = _num(data.get("encCorrect"))
        enc_wrong = _num(data.get("encWrong"))
        cat_correct = _num(data.get("catCorrect"))
        cat_wrong = _num(data.get("catWrong"))
        if enc_correct is not None or cat_correct is not None:
            if enc_correct is not None:
                text = f"编码答对 {_fmt(enc_correct)} 题"
                if enc_wrong is not None:
                    text += f"、答错 {_fmt(enc_wrong)} 题"
                clauses.append(text)
            if cat_correct is not None:
                text = f"分类答对 {_fmt(cat_correct)} 题"
                if cat_wrong is not None:
                    text += f"、答错 {_fmt(cat_wrong)} 题"
                clauses.append(text)
        else:
            trials = _num(data.get("trials"))
            correct = _num(data.get("correct"))
            if trials is not None and correct is not None:
                clauses.append(f"完成 {_fmt(trials)} 题、答对 {_fmt(correct)} 题")
            elif correct is not None:
                clauses.append(f"答对 {_fmt(correct)} 题")
            elif trials is not None:
                clauses.append(f"完成 {_fmt(trials)} 题")
    elif dim == "am":
        # 联想记忆现行任务是 PAL（图案—位置配对）：一次点对数 / 重试次数。
        # 旧记录里可能只有 hits/falseAlarms（词对再认时代），按同一口径表述，避免文案自相矛盾。
        first_try = _num(data.get("firstTry"))
        targets = _num(data.get("targets"))
        errors = _num(data.get("errors"))
        hits = _num(data.get("hits"))
        false_alarms = _num(data.get("falseAlarms"))
        if first_try is not None and targets is not None and targets > 0:
            clauses.append(f"一次点对 {_fmt(first_try)}/{_fmt(targets)} 组")
            if errors is not None:
                clauses.append(f"重试 {_fmt(errors)} 次")
        elif hits is not None or false_alarms is not None:
            if hits is not None and false_alarms is not None:
                clauses.append(f"一次点对 {_fmt(hits)} 组、重试 {_fmt(false_alarms)} 次")
            elif hits is not None:
                clauses.append(f"一次点对 {_fmt(hits)} 组")
            else:
                clauses.append(f"重试 {_fmt(false_alarms)} 次")
    else:
        correct = _num(data.get("correct"))
        total = _num(data.get("total"))
        weighted = _num(data.get("weighted"))
        valid_count = _num(data.get("validCount"))
        if valid_count is not None:
            clauses.append(f"说出 {_fmt(valid_count)} 个有效项")
        if dim == "sv" and weighted is not None and total is not None and total > 0:
            clauses.append(f"按转动次数加权后 {_fmt(weighted)}/{_fmt(total)}")
        if correct is not None and total is not None and total > 0:
            clauses.append(f"{_fmt(total)} 题答对 {_fmt(correct)} 题")
        elif correct is not None:
            clauses.append(f"答对 {_fmt(correct)} 题")
        elif total is not None:
            clauses.append(f"共 {_fmt(total)} 题")

    mean_rt = _num(data.get("meanRtMs"))
    if mean_rt is not None and mean_rt > 0:
        clauses.append(f"平均每次作答约 {mean_rt / 1000.0:.1f} 秒")

    # 最后一道闸：任何子句里都不许留下 None/null。
    return [
        clause
        for clause in clauses
        if clause and "None" not in clause and "null" not in clause
    ]


def _facts(dim: str, metrics: dict) -> list[str]:
    """措辞变体只换描述前缀，数字一律来自 `metric_clauses`（缺字段就不写）。"""
    data = metrics if isinstance(metrics, dict) else {}
    clauses = metric_clauses(dim, data)
    if not clauses:
        return []
    body = "；".join(clauses)
    lead = {
        "vc": [
            "言语理解 · 判断词语关系是否相近",
            "言语理解 · 词义辨析（四选一）",
            "言语理解 · 从四个近义词里选最接近的一个",
        ],
        "ps": [
            "知觉速度 · 按符号表做编码与分类判断",
            "知觉速度 · 限时符号编码加颜色分类",
            "知觉速度 · 查表编码 + 相近颜色分类",
        ],
        "sv": [
            "空间视觉化 · 判断图形旋转后是否与目标一致",
            "空间视觉化 · 图形旋转判断",
            "空间视觉化 · 在平面里比对旋转后的图形",
        ],
        "am": [
            "联想记忆 · 先记图案与位置的配对",
            "联想记忆 · 配对练习后再点位置",
            "联想记忆 · 图案与位置一起看",
        ],
    }.get(dim, [f"{DIM_NAMES.get(dim, dim)} · 本次原始记录"])
    return [f"{prefix}：{body}" for prefix in lead]


def _ratio(metrics: dict, top: str, bottom: str) -> float | None:
    data = metrics if isinstance(metrics, dict) else {}
    part = _num(data.get(top))
    whole = _num(data.get(bottom))
    if part is None or whole is None or whole <= 0:
        return None
    return part / whole


def _ps_wrong(metrics: dict) -> float | None:
    """新口径（encWrong+catWrong）优先，退回旧口径 wrong。"""
    data = metrics if isinstance(metrics, dict) else {}
    enc_wrong = _num(data.get("encWrong"))
    cat_wrong = _num(data.get("catWrong"))
    if enc_wrong is not None or cat_wrong is not None:
        return (enc_wrong or 0.0) + (cat_wrong or 0.0)
    return _num(data.get("wrong"))


def reading_sentence(dim: str, metrics: dict | None) -> str:
    """对外：这组数字怎么读（只谈任务条件，缺数据就给不依赖数字的一句）。"""
    return _reading(dim, metrics if isinstance(metrics, dict) else {})


def _reading(dim: str, metrics: dict) -> str:
    """怎么读这组数字：只谈任务条件，缺数据就给一句不依赖数字的话。"""
    data = metrics if isinstance(metrics, dict) else {}
    if dim == "vc":
        ratio = _ratio(data, "correct", "total")
        if ratio is None:
            return "这次没有留下可读的题量与正确数，先把这一项的作答记录补齐再谈。"
        if ratio >= 0.85:
            return "这次对的题比较多，词义判断整体顺利。"
        if ratio >= 0.6:
            return "大部分题目判断正确，难点可能落在近义词的细微差别上。"
        return "这次对的题偏少，近义词之间的细微差别可能是主要难点。"
    if dim == "ps":
        wrong = _ps_wrong(data)
        if wrong is None:
            return "限时任务的结果同时反映速度与策略，要结合编码与分类两段的题量一起看。"
        if wrong == 0:
            return "全程没有判断错误：限时任务要在快和准之间取舍，这次偏向了准。"
        return f"有 {int(wrong)} 次判断错误：限时任务的结果同时反映速度与策略，要结合作答量一起看。"
    if dim == "sv":
        ratio = _ratio(data, "correct", "total")
        if ratio is None:
            return "旋转题的题量与正确数没记全，先补齐记录再看这一项。"
        if ratio >= 0.9:
            return "这次没有出现判断错误，图像操作比较顺。"
        return "旋转判断有几题没对上，可以先在脑内把图转完再选。"
    false_alarms = _num(data.get("falseAlarms"))
    if false_alarms is None:
        return "位置记忆的一次点对数与重试次数要一起看；这次没记全，先补齐记录再谈。"
    if false_alarms >= 3:
        return "重试多说明这几组图案与位置的配对还没记牢，不代表「记性差」。"
    return "重试很少，说明这次图案与位置的配对大多一次就对上了。"


def _error_rate(dim: str, metrics: dict) -> float | None:
    """None = 这项没有可算错误率的数据（不要当成 0 参与"最弱项"挑选）。"""
    data = metrics if isinstance(metrics, dict) else {}
    if dim == "ps":
        trials = _num(data.get("trials"))
        if trials is None:
            parts = [
                _num(data.get("encCorrect")),
                _num(data.get("encWrong")),
                _num(data.get("catCorrect")),
                _num(data.get("catWrong")),
            ]
            if all(part is None for part in parts):
                return None
            trials = sum(part or 0.0 for part in parts)
        wrong = _ps_wrong(data)
        if wrong is None or not trials:
            return None
        return wrong / trials
    if dim == "am":
        hits = _num(data.get("hits"))
        false_alarms = _num(data.get("falseAlarms"))
        if hits is None or false_alarms is None:
            first_try, targets = _num(data.get("firstTry")), _num(data.get("targets"))
            if first_try is None or not targets:
                return None
            return max(0.0, (targets - first_try) / targets)
        total = hits + false_alarms
        return false_alarms / total if total else None
    ratio = _ratio(data, "correct", "total")
    return 1.0 - ratio if ratio is not None else None


def _weakest(measured: list[str], facts: dict) -> str | None:
    """错误率最高的维度；全部缺数据时返回 None（不硬挑一个"最弱"）。"""
    scored: list[tuple[str, float]] = []
    for dim in measured:
        rate = _error_rate(dim, facts[dim])
        if rate is not None:
            scored.append((dim, rate))
    if not scored:
        return None
    return max(scored, key=lambda pair: pair[1])[0]


def template_narrative(facts: dict | None) -> str:
    """生成报告用的模板解读；没有可读指标时退回一句说明。"""
    data = {k: v for k, v in (facts or {}).items() if k in SUPPORT_DIMS and isinstance(v, dict)}
    if not data:
        return "本次还没有可解读的原始指标。完成测评后会在这里给出说明。"

    rng = random.Random()
    lines = []
    for dim in DIM_ORDER:
        if dim not in data:
            continue
        variants = _facts(dim, data[dim])
        if not variants:  # 这一项一个字段都没取到：不写空行，也不写 None
            continue
        lines.append(f"· {rng.choice(variants)}。{_reading(dim, data[dim])}")
    measured = [dim for dim in DIM_ORDER if dim in data]

    if not lines:
        return (
            "本次这几项任务没有留下可复述的原始字段，所以这里不编数字。"
            "可以重新完成一次标准测评，或在对话里换个问法再看。"
        )

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
            "这个账号还没有两次可比的测评，或者两次测评没有共同测过的维度。"
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
