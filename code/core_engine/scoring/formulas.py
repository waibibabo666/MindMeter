"""Eight task formulas, kept line-for-line equivalent to `src/scoring/formulas.js`.

约定（与前端一致，不要单方面改其中一边）：

* 输入是任务上报的 metrics，不读全局状态；
* 返回 0–100 整数，或 null（未测 / 数据不足 / 完成度不够）；
* 不返回总分，也不把维度互相组合；
* `expected`/`seconds` 省略时回落到 CONFIG 的固定值，方便单测直接调公式。
"""
from __future__ import annotations

import math

from .config import CONFIG
from .stats import clamp01, filter_rts, median, z_inv


def _int100(value: float) -> int:
    """与 JS `Math.round(100 * x + 1e-9)` 同结果：真 .5 稳定向上取整。"""
    return int(math.floor(100 * value + 1e-9 + 0.5))


def _num(value) -> float | None:
    return value if isinstance(value, (int, float)) and math.isfinite(value) else None


def _too_few(total, expected: float) -> bool:
    value = _num(total)
    return value is None or value < expected * CONFIG["minCompletion"]


def _accuracy(metrics: dict | None, expected: float) -> int | None:
    if not metrics:
        return None
    total = _num(metrics.get("total"))
    correct = _num(metrics.get("correct"))
    if total is None or total < expected * CONFIG["minCompletion"]:
        return None
    if correct is None or correct < 0:
        return None
    return _int100(clamp01(correct / total))


def score_vc(metrics: dict | None, expected: float | None = None) -> int | None:
    """言语理解：正确率按四选一猜测校正，全猜得 0 分而不是 25 分。"""
    if not metrics:
        return None
    want = CONFIG["vc"]["items"] if expected is None else expected
    total = _num(metrics.get("total"))
    correct = _num(metrics.get("correct"))
    if total is None or total < want * CONFIG["minCompletion"]:
        return None
    if correct is None or correct < 0:
        return None
    guess = CONFIG["vc"]["guess"]
    accuracy = correct / total
    return _int100(clamp01((accuracy - guess) / (1 - guess)))


def score_ps(metrics: dict | None, seconds: float | None = None) -> int | None:
    """知觉速度：新版编码+分类双段（错题扣 0.5，按时长折算）；旧版只给 correct。"""
    if not metrics:
        return None
    cfg = CONFIG["ps"]
    time_span = cfg["seconds"] if seconds is None else seconds
    scale = 45.0 / max(1.0, time_span)

    enc_correct = _num(metrics.get("encCorrect"))
    cat_correct = _num(metrics.get("catCorrect"))
    if enc_correct is not None or cat_correct is not None:
        low, high = cfg["encLow"], cfg["encHigh"]
        net_enc = (enc_correct or 0.0) - 0.5 * (_num(metrics.get("encWrong")) or 0.0)
        net_cat = (cat_correct or 0.0) - 0.5 * (_num(metrics.get("catWrong")) or 0.0)
        enc_score = clamp01((net_enc * scale - low) / (high - low))
        cat_score = clamp01((net_cat * scale - low) / (high - low))
        return _int100(clamp01(cfg["wEnc"] * enc_score + cfg["wCat"] * cat_score))

    correct = _num(metrics.get("correct"))
    if correct is None:
        return None
    low, high = cfg["low"], cfg["high"]
    rate = correct if time_span == 45 else correct * scale
    return _int100(clamp01((rate - low) / (high - low)))


def sv_median_rt(metrics: dict | None) -> int | None:
    """报告展示用的中位反应时：与计分用完全相同的剔除规则。"""
    if not metrics or not isinstance(metrics.get("correctRts"), list):
        return None
    rt = median(filter_rts(metrics["correctRts"], CONFIG["sv"]["minRt"]))
    return None if rt is None else int(math.floor(rt + 0.5))


def score_sv(metrics: dict | None, expected: float | None = None) -> int | None:
    """空间视觉化：优先加权正确率（展开图按转动次数给分），否则正确率+反应时加权。"""
    if not metrics:
        return None
    cfg = CONFIG["sv"]
    want = cfg["items"] if expected is None else expected

    weighted = _num(metrics.get("weighted"))
    total = _num(metrics.get("total"))
    if weighted is not None and total is not None:
        if total < want * CONFIG["minCompletion"]:
            return None
        p = weighted / total
        guess = cfg["guess"]
        return _int100(clamp01((p - guess) / (1 - guess)))

    if total is None or total < want * CONFIG["minCompletion"]:
        return None
    correct = _num(metrics.get("correct"))
    if correct is None or correct < cfg["minCorrect"]:
        return None
    rts = filter_rts(metrics.get("correctRts") or [], cfg["minRt"])
    rt = median(rts)
    if rt is None:
        return None
    acc_score = clamp01(correct / total)
    rt_best = cfg["rtBest"]
    rt_score = clamp01((cfg["rtWorst"] - rt) / ((cfg["rtWorst"] - rt_best) if rt_best else 1))
    return _int100(clamp01(cfg["wAcc"] * acc_score + cfg["wRt"] * rt_score))


def score_am(metrics: dict | None, answers: list | None = None) -> int | None:
    """联想记忆：PAL 口径（一次点对/目标数，六选一校正）优先，否则信号检测论 d'。"""
    if not metrics:
        return None

    targets_metric = _num(metrics.get("targets"))
    first_try = _num(metrics.get("firstTry"))
    if targets_metric is not None and first_try is not None:
        rate = first_try / max(1.0, targets_metric)
        guess = 1.0 / CONFIG["am"]["choices"]
        return _int100(clamp01((rate - guess) / (1 - guess)))

    hits = _num(metrics.get("hits"))
    false_alarms = _num(metrics.get("falseAlarms"))
    if hits is None or false_alarms is None:
        return None

    targets = float(CONFIG["am"]["targets"])
    foils = float(CONFIG["am"]["foils"])
    if isinstance(answers, list) and answers:
        old_count = sum(1 for a in answers if isinstance(a, dict) and a.get("isOld"))
        new_count = sum(1 for a in answers if isinstance(a, dict) and not a.get("isOld"))
        if old_count > 0:
            targets = float(old_count)
        if new_count > 0:
            foils = float(new_count)

    h = (hits + 0.5) / (targets + 1)
    f = (false_alarms + 0.5) / (foils + 1)
    d_prime = z_inv(h) - z_inv(f)
    return _int100(clamp01((d_prime + 1) / 5))


def score_vf(metrics: dict | None, seconds: float | None = None) -> int | None:
    """言语流畅性：有效词数按 60 秒锚点折算；ASR 不可用直接 null。"""
    if not metrics:
        return None
    if metrics.get("unavailable"):
        return None
    valid = _num(metrics.get("validCount"))
    if valid is None or valid < 0:
        return None
    cfg = CONFIG["vf"]
    time_span = cfg["seconds"] if seconds is None else seconds
    rate = valid if time_span == 60 else valid * (60.0 / max(1.0, time_span))
    return _int100(clamp01((rate - cfg["floor"]) / cfg["span"]))


def score_nc(metrics: dict | None, expected: float | None = None) -> int | None:
    return _accuracy(metrics, CONFIG["nc"]["items"] if expected is None else expected)


def score_ir(metrics: dict | None, expected: float | None = None) -> int | None:
    return _accuracy(metrics, CONFIG["ir"]["items"] if expected is None else expected)


def score_ni(metrics: dict | None, expected: float | None = None) -> int | None:
    return _accuracy(metrics, CONFIG["ni"]["items"] if expected is None else expected)
