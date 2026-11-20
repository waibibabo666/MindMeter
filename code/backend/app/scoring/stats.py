"""Pure math helpers ported from the frozen JS scoring module."""
from __future__ import annotations

import math


def clamp01(value: float) -> float:
    if not math.isfinite(value):
        return 0.0
    return min(1.0, max(0.0, value))


def median(values: list[float]) -> float | None:
    nums = sorted(v for v in values if isinstance(v, (int, float)) and math.isfinite(v))
    if not nums:
        return None
    mid = len(nums) // 2
    if len(nums) % 2 == 1:
        return float(nums[mid])
    return (nums[mid - 1] + nums[mid]) / 2.0


def filter_rts(values: list[float], min_rt: float = 200.0) -> list[float]:
    nums = [v for v in values if isinstance(v, (int, float)) and math.isfinite(v) and v >= min_rt]
    if not nums:
        return []
    m = median(nums)
    if m is None:
        return []
    return [v for v in nums if v <= 3 * m]


def z_inv(p: float) -> float:
    """Acklam's inverse normal CDF approximation (relative error < 1.15e-9)."""
    q = p
    if not math.isfinite(q):
        return 0.0
    if q <= 0:
        q = 1e-6
    if q >= 1:
        q = 1 - 1e-6

    a = [
        -3.969683028665376e1,
        2.209460984245205e2,
        -2.759285104469687e2,
        1.38357751867269e2,
        -3.066479806614716e1,
        2.506628277459239,
    ]
    b = [
        -5.447609879822406e1,
        1.615858368580409e2,
        -1.556989798598866e2,
        6.680131188771972e1,
        -1.328068155288572e1,
    ]
    c = [
        -7.784894002430293e-3,
        -3.223964580411365e-1,
        -2.400758277161838,
        -2.549732539343734,
        4.374664141464968,
        2.938163982698783,
    ]
    d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]

    if q < 0.02425:
        r = math.sqrt(-2 * math.log(q))
        return (
            (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5])
            / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1)
        )
    if q > 1 - 0.02425:
        r = math.sqrt(-2 * math.log(1 - q))
        return -(
            (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5])
            / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1)
        )
    r = q - 0.5
    s = r * r
    return (
        ((((((a[0] * s + a[1]) * s + a[2]) * s + a[3]) * s + a[4]) * s + a[5]) * r)
        / (((((b[0] * s + b[1]) * s + b[2]) * s + b[3]) * s + b[4]) * s + 1)
    )
