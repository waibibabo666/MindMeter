"""scoring-v3.3 thresholds and the per-level item table.

v3.3：ir/ni 补上猜测校正（ir 四选一 0.25，ni 现行题型三选一 1/3），并新增作答合法性
校验（计数为负、正确数超过总数、题数超过该档发放数、限时任务的作答速度超过人类上限
一律记 null）。校验上限放在 CONFIG 里，不写进公式。

v3.1 的 Python 端口只搬了"固定分母"，没有跟着前端把三档题量与新版公式搬过来：
vc 缺四选一猜测校正、ps 缺编码/分类双段、sv 缺加权正确率、am 缺 PAL 口径、
vf 不按秒数折算，nc/ir/ni 还按 20/15/20 题判完成率 —— 而标准档实际只下发
10/8/8 题，于是这三维的服务端分数恒为 null。v3.2 把口径统一到
`code/frontend/src/scoring/*`（同一套 LEVEL_SPEC、同一套公式），
两端必须给出同一个数，否则报告页与趋势页会各说各话。

阈值调整只改这里，不改公式代码。
"""
from __future__ import annotations

SCORING_VERSION = "scoring-v3.3"
DIMENSION_IDS = ["vc", "vf", "nc", "ps", "ir", "sv", "am", "ni"]

CONFIG = {
    # 固定题量类任务：完成率低于该比例视为未完成，记 null。
    "minCompletion": 0.8,
    "vc": {"items": 6, "guess": 0.25},
    "vf": {"floor": 10, "span": 20, "seconds": 60, "maxPerSecond": 4},
    "nc": {"items": 20},
    "ps": {
        "low": 8,
        "high": 24,
        "encLow": 6,
        "encHigh": 30,
        "wEnc": 0.7,
        "wCat": 0.3,
        "seconds": 45,
        "maxPerSecond": 5,
    },
    "ir": {"items": 15, "guess": 0.25},
    "sv": {
        "items": 8,
        "rtBest": 1500,
        "rtWorst": 4000,
        "minCorrect": 4,
        "minRt": 200,
        "wAcc": 0.7,
        "wRt": 0.3,
        "guess": 0.25,
    },
    "ni": {"items": 20, "guess": 1 / 3},
    "am": {"targets": 8, "foils": 8, "choices": 6},
}

# 与 code/frontend/src/scoring/levels.js 的 LEVEL_SPEC 一一对应。
# 同一维度在三档用同一个测量工具，只改题量/时长，跨档方向可比、精度不同。
LEVEL_SPEC = {
    "quick": {
        "vc": {"items": 4},
        "ps": {"seconds": 30},
        "sv": {"items": 6},
        "am": {"pairs": 6, "items": 6},
        "nc": {"items": 6},
        "ir": {"items": 6},
        "ni": {"items": 6},
        "vf": {"seconds": 20},
    },
    "standard": {
        "vc": {"items": 8},
        "ps": {"seconds": 45},
        "sv": {"items": 8},
        "am": {"pairs": 6, "items": 6},
        "nc": {"items": 10},
        "ir": {"items": 8},
        "ni": {"items": 8},
        "vf": {"seconds": 30},
    },
    "deep": {
        "vc": {"items": 12},
        "ps": {"seconds": 90},
        "sv": {"items": 12},
        "am": {"pairs": 6, "items": 6},
        "nc": {"items": 10},
        "ir": {"items": 8},
        "ni": {"items": 8},
        "vf": {"seconds": 45},
    },
}

LEVELS = ("quick", "standard", "deep")


def spec_for(level: str | None, dim: str) -> dict:
    """该档位该维度的参数；未知档位回落到 standard（与前端一致）。"""
    table = LEVEL_SPEC.get(str(level or "standard"), LEVEL_SPEC["standard"])
    return table.get(dim, LEVEL_SPEC["standard"].get(dim, {}))


def items_for(level: str | None, dim: str) -> int:
    return int(spec_for(level, dim).get("items", CONFIG.get(dim, {}).get("items", 0)))


def seconds_for(level: str | None, dim: str) -> float:
    return float(spec_for(level, dim).get("seconds", CONFIG.get(dim, {}).get("seconds", 0)))
