"""Four task formulas, ported exactly from scoring-v3.1."""
from __future__ import annotations

import math

from .config import CONFIG
from .stats import clamp01, filter_rts, median, z_inv


def _int100(value: float) -> int:
    return int(math.floor(100 * value + 1e-9 + 0.5))


def _too_few(total, expected: int) -> bool:
    if not isinstance(total, (int, float)) or not math.isfinite(total):
        return True
    return total < expected * CONFIG["minCompletion"]


def score_vc(metrics: dict | None) -> int | None:
    if not metrics:
        return None
    total = metrics.get("total")
    correct = metrics.get("correct")
    if _too_few(total, CONFIG["vc"]["items"]):
        return None
    if not isinstance(correct, (int, float)) or not math.isfinite(correct) or correct < 0:
        return None
    return _int100(clamp01(correct / total))


def score_ps(metrics: dict | None) -> int | None:
    if not metrics:
        return None
    correct = metrics.get("correct")
    if not isinstance(correct, (int, float)) or not math.isfinite(correct):
        return None
    low = CONFIG["ps"]["low"]
    high = CONFIG["ps"]["high"]
    return _int100(clamp01((correct - low) / (high - low)))


def sv_median_rt(metrics: dict | None) -> int | None:
    if not metrics or not isinstance(metrics.get("correctRts"), list):
        return None
    rt = median(filter_rts(metrics["correctRts"], CONFIG["sv"]["minRt"]))
    return None if rt is None else int(math.floor(rt + 0.5))


def score_sv(metrics: dict | None) -> int | None:
    if not metrics:
        return None
    total = metrics.get("total")
    correct = metrics.get("correct")
    if _too_few(total, CONFIG["sv"]["items"]):
        return None
    if not isinstance(correct, (int, float)) or not math.isfinite(correct):
        return None
    if correct < CONFIG["sv"]["minCorrect"]:
        return None
    rts = filter_rts(metrics.get("correctRts") or [], CONFIG["sv"]["minRt"])
    rt = median(rts)
    if rt is None:
        return None
    cfg = CONFIG["sv"]
    acc_score = clamp01(correct / total)
    rt_score = clamp01((cfg["rtWorst"] - rt) / (cfg["rtWorst"] - cfg["rtBest"]))
    return _int100(clamp01(cfg["wAcc"] * acc_score + cfg["wRt"] * rt_score))


def score_am(metrics: dict | None, answers: list | None = None) -> int | None:
    if not metrics:
        return None
    hits = metrics.get("hits")
    false_alarms = metrics.get("falseAlarms")
    if not isinstance(hits, (int, float)) or not math.isfinite(hits):
        return None
    if not isinstance(false_alarms, (int, float)) or not math.isfinite(false_alarms):
        return None

    targets = CONFIG["am"]["targets"]
    foils = CONFIG["am"]["foils"]
    if isinstance(answers, list) and answers:
        old_count = sum(1 for a in answers if isinstance(a, dict) and a.get("isOld"))
        new_count = sum(1 for a in answers if isinstance(a, dict) and not a.get("isOld"))
        if old_count > 0:
            targets = old_count
        if new_count > 0:
            foils = new_count

    h = (hits + 0.5) / (targets + 1)
    f = (false_alarms + 0.5) / (foils + 1)
    d_prime = z_inv(h) - z_inv(f)
    return _int100(clamp01((d_prime + 1) / 5))


def score_vf(metrics: dict | None) -> int | None:
    if not metrics:
        return None
    valid = metrics.get("validCount")
    if not isinstance(valid, (int, float)) or not math.isfinite(valid) or valid < 0:
        return None
    cfg = CONFIG["vf"]
    return _int100(clamp01((valid - cfg["floor"]) / cfg["span"]))


def _score_accuracy(metrics: dict | None, dim: str) -> int | None:
    if not metrics:
        return None
    total = metrics.get("total")
    correct = metrics.get("correct")
    if _too_few(total, CONFIG[dim]["items"]):
        return None
    if not isinstance(correct, (int, float)) or not math.isfinite(correct) or correct < 0:
        return None
    return _int100(clamp01(correct / total))


def score_nc(metrics: dict | None) -> int | None:
    return _score_accuracy(metrics, "nc")


def score_ir(metrics: dict | None) -> int | None:
    return _score_accuracy(metrics, "ir")


def score_ni(metrics: dict | None) -> int | None:
    return _score_accuracy(metrics, "ni")
