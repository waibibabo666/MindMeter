"""游戏质量评估：小样本下持续更新的后验。

背景：24 个游戏是否真能反映对应维度、难度是否合适，现在找不到足够多的人来测。
所以这里不等样本攒够再一次性分析，而是每来一局就更新一次后验，样本少时诚实地说
「数据不足」，样本多了自动变得果断。

三层方法，由快到稳：

1. CTT 快速诊断：局数、均分、标准差、通过率。
2. 贝叶斯序贯判断（主力）：
   * 区分度：极端组 D（上 27% 与下 27% 的通过率之差）。两组通过率各取 Beta 后验，
     算 P(D ≥ 0.30)；≥ 0.90 判合格，≤ 0.10 判不足，其余继续收集。只看最近 WINDOW 局。
   * 天花板 / 地板：满分段（≥ 90）与低分段（≤ 10）占比的 Beta 后验可信区间，
     按区间下界分级告警，而不是点估计一过线就报。
   * 同一维度的 3 个游戏用 pooled 先验互相借用信息（经验贝叶斯，矩估计），
     样本越少越贴近同维度的整体水平。
3. 限制性 IRT 兜底：D 仍无法判定、但局数已够时，用 2PL（区分度 a 被对数正态先验
   限制在 0.4–2.5）做网格 MAP，看 a 是否过低。

只用标准库：部署环境没有 numpy / scipy。
"""
from __future__ import annotations

import math
import random
from collections import defaultdict
from statistics import mean, pstdev
from typing import Iterable

PASS_SCORE = 60  # ≥ 此分算「通过」
CEILING_SCORE = 90  # ≥ 此分算满分段
FLOOR_SCORE = 10  # ≤ 此分算低分段
EXTREME_SHARE = 0.27
WINDOW = 300  # 每个游戏只看最近这么多局（滑动窗口）
MIN_EXTREME_PLAYS = 10  # 可参与区分度的局数少于此值，不下结论
MIN_IRT_PLAYS = 30
D_TARGET = 0.30
EXTREME_PRIOR_STRENGTH = 2.0
SEQ_ACCEPT = 0.90
SEQ_REJECT = 0.10
DRAWS = 4000

Play = tuple[int, str, str, float]  # (user_id, game_id, dim, score)


# ---------------------------------------------------------------- Beta 工具


def _draws(a: float, b: float, rng: random.Random, n: int = DRAWS) -> list[float]:
    return [rng.betavariate(a, b) for _ in range(n)]


def _quantile(sorted_values: list[float], q: float) -> float:
    index = min(len(sorted_values) - 1, max(0, int(round(q * (len(sorted_values) - 1)))))
    return sorted_values[index]


def credible_interval(a: float, b: float, rng: random.Random, level: float = 0.95) -> tuple[float, float]:
    values = sorted(_draws(a, b, rng))
    tail = (1 - level) / 2
    return _quantile(values, tail), _quantile(values, 1 - tail)


def pooled_prior(
    rates: list[tuple[float, int]], default_strength: float = 4.0, cap: float = 30.0
) -> tuple[float, float]:
    """同维度各游戏的比例 → Beta 先验（矩估计）。

    `rates` 是 `(比例, 样本量)`。少于 2 个有数据的游戏时，只能给弱先验；
    各游戏差异比抽样误差还小时，说明它们本来就很像，先验可以强一些（上限 cap）。
    """
    points = [(r, n) for r, n in rates if n > 0]
    if not points:
        return 0.5 * default_strength, 0.5 * default_strength
    total = sum(n for _, n in points)
    center = sum(r * n for r, n in points) / total
    center = min(0.95, max(0.05, center))
    if len(points) < 2:
        strength = default_strength
    else:
        between = pstdev([r for r, _ in points]) ** 2
        sampling = sum(center * (1 - center) / n for _, n in points) / len(points)
        excess = between - sampling
        strength = cap if excess <= 1e-4 else center * (1 - center) / excess - 1
        strength = min(cap, max(2.0, strength))
    return center * strength, (1 - center) * strength


# ---------------------------------------------------------------- 整理数据


def _windowed(plays: Iterable[Play]) -> dict[str, list[Play]]:
    """按游戏分组，只留最近 WINDOW 局（输入需按时间升序）。"""
    by_game: dict[str, list[Play]] = defaultdict(list)
    for play in plays:
        by_game[play[1]].append(play)
    return {game: rows[-WINDOW:] for game, rows in by_game.items()}


def _criterion(plays_by_game: dict[str, list[Play]]) -> dict[tuple[int, str], float]:
    """每个 (用户, 游戏) 的外部效标：该用户在**同维度其他游戏**上的平均成绩。

    效标里不含被评估的游戏本身，否则区分度会被自己抬高。
    """
    per_user_game: dict[tuple[int, str], list[float]] = defaultdict(list)
    dim_of: dict[str, str] = {}
    for game, rows in plays_by_game.items():
        for uid, _, dim, score in rows:
            per_user_game[(uid, game)].append(score)
            dim_of[game] = dim
    means = {key: mean(values) for key, values in per_user_game.items()}
    result: dict[tuple[int, str], float] = {}
    for (uid, game) in means:
        others = [
            value
            for (other_uid, other_game), value in means.items()
            if other_uid == uid and other_game != game and dim_of.get(other_game) == dim_of.get(game)
        ]
        if others:
            result[(uid, game)] = mean(others)
    return result


# ---------------------------------------------------------------- 单项判断


def _grade_extreme(lower: float, upper: float) -> str:
    """按可信区间给分级：下界过线才报，区间还很宽时只说「待观察」。"""
    if lower >= 0.30:
        return "severe"
    if lower >= 0.15:
        return "warn"
    if upper < 0.15:
        return "ok"
    return "watch"


def _irt_2pl(thetas: list[float], passed: list[int]) -> dict:
    """限制性 2PL：a 受对数正态先验约束，b 受正态先验约束，网格 MAP。"""
    best = (-math.inf, 1.0, 0.0)
    for a_step in range(0, 22):
        a = 0.4 + a_step * 0.1  # 0.4 … 2.5
        log_prior_a = -((math.log(a) - 0.0) ** 2) / (2 * 0.5**2)
        for b_step in range(-25, 26):
            b = b_step * 0.1
            log_prior_b = -(b**2) / (2 * 1.5**2)
            ll = 0.0
            for theta, y in zip(thetas, passed):
                p = 1.0 / (1.0 + math.exp(-a * (theta - b)))
                p = min(1 - 1e-6, max(1e-6, p))
                ll += math.log(p) if y else math.log(1 - p)
            total = ll + log_prior_a + log_prior_b
            if total > best[0]:
                best = (total, a, b)
    return {"a": round(best[1], 2), "b": round(best[2], 2)}


def evaluate(plays: Iterable[Play], seed: int = 20261126) -> dict:
    """输入全部游戏局记录（按时间升序），输出每个游戏的诊断。"""
    rng = random.Random(seed)
    by_game = _windowed(plays)
    criterion = _criterion(by_game)
    dims: dict[str, list[str]] = defaultdict(list)
    for game, rows in by_game.items():
        dims[rows[0][2]].append(game)

    def rate(game: str, test) -> tuple[float, int]:
        scores = [row[3] for row in by_game[game]]
        return (sum(1 for s in scores if test(s)) / len(scores), len(scores)) if scores else (0.0, 0)

    priors = {
        dim: {
            "pass": pooled_prior([rate(g, lambda s: s >= PASS_SCORE) for g in games]),
            "ceiling": pooled_prior([rate(g, lambda s: s >= CEILING_SCORE) for g in games]),
            "floor": pooled_prior([rate(g, lambda s: s <= FLOOR_SCORE) for g in games]),
        }
        for dim, games in dims.items()
    }

    report: dict[str, dict] = {}
    for game, rows in by_game.items():
        dim = rows[0][2]
        scores = [row[3] for row in rows]
        n = len(scores)
        entry: dict = {
            "dim": dim,
            "plays": n,
            "players": len({row[0] for row in rows}),
            "mean": round(mean(scores), 1),
            "sd": round(pstdev(scores), 1) if n > 1 else 0.0,
            "passRate": round(sum(1 for s in scores if s >= PASS_SCORE) / n, 2),
            "flags": [],
        }

        for key, test, label in (
            ("ceiling", lambda s: s >= CEILING_SCORE, "天花板"),
            ("floor", lambda s: s <= FLOOR_SCORE, "地板"),
        ):
            hits = sum(1 for s in scores if test(s))
            a0, b0 = priors[dim][key]
            low, high = credible_interval(a0 + hits, b0 + n - hits, rng)
            grade = _grade_extreme(low, high)
            entry[key] = {
                "rate": round(hits / n, 2),
                "ci95": [round(low, 2), round(high, 2)],
                "grade": grade,
            }
            if grade in {"warn", "severe"}:
                entry["flags"].append(
                    f"{label}效应{'严重' if grade == 'severe' else '预警'}："
                    f"{round(hits / n * 100)}% 的局落在极端段（95% 区间 {round(low * 100)}–{round(high * 100)}%）"
                )

        eligible = [(criterion[(row[0], game)], row[3]) for row in rows if (row[0], game) in criterion]
        entry["discrimination"] = {"eligible": len(eligible), "verdict": "insufficient"}
        if len(eligible) >= MIN_EXTREME_PLAYS:
            ranked = sorted(eligible, key=lambda pair: pair[0])
            k = max(3, math.ceil(EXTREME_SHARE * len(ranked)))
            lower, upper = ranked[:k], ranked[-k:]
            # 两个极端组共用同一个先验：先验越强，两组越被拉向同一个值，D 就被系统性压向 0。
            # 所以这里只借用 pooled 的中心位置，强度固定为弱先验（2）。
            pa, pb = priors[dim]["pass"]
            center = pa / (pa + pb)
            a0, b0 = center * EXTREME_PRIOR_STRENGTH, (1 - center) * EXTREME_PRIOR_STRENGTH
            pu = sum(1 for _, s in upper if s >= PASS_SCORE)
            pl = sum(1 for _, s in lower if s >= PASS_SCORE)
            up = _draws(a0 + pu, b0 + k - pu, rng)
            lo = _draws(a0 + pl, b0 + k - pl, rng)
            diffs = [x - y for x, y in zip(up, lo)]
            p_good = sum(1 for d in diffs if d >= D_TARGET) / len(diffs)
            verdict = "good" if p_good >= SEQ_ACCEPT else "weak" if p_good <= SEQ_REJECT else "collecting"
            entry["discrimination"].update(
                {
                    "groupSize": k,
                    "D": round(mean(diffs), 2),
                    "pGood": round(p_good, 2),
                    "verdict": verdict,
                }
            )
            if verdict == "weak":
                entry["flags"].append(
                    f"区分度不足：高低组通过率之差达到 {D_TARGET} 的概率只有 {round(p_good * 100)}%，"
                    "这个游戏可能没有测到它所属的维度"
                )
            if verdict == "collecting" and len(eligible) >= MIN_IRT_PLAYS:
                criteria = [c for c, _ in eligible]
                spread = pstdev(criteria) or 1.0
                thetas = [(c - mean(criteria)) / spread for c in criteria]
                irt = _irt_2pl(thetas, [1 if s >= PASS_SCORE else 0 for _, s in eligible])
                entry["discrimination"]["irt"] = irt
                if irt["a"] < 0.6:
                    entry["flags"].append(f"IRT 兜底：区分度参数 a={irt['a']} 偏低，建议优先复查题目")
        else:
            entry["flags"].append(
                f"数据不足：可用于区分度的局数 {len(eligible)}/{MIN_EXTREME_PLAYS}"
                "（同一个人需要玩过本维度的至少两个游戏）"
            )
        report[game] = entry
    return report
