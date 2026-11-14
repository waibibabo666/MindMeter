"""The single authoritative server-side scoring engine."""
from __future__ import annotations

from .config import CONFIG, DIMENSION_IDS, SCORING_VERSION
from .formulas import (
    score_am,
    score_ir,
    score_nc,
    score_ni,
    score_ps,
    score_sv,
    score_vc,
    score_vf,
    sv_median_rt,
)


def score_session(results: dict | None) -> dict:
    results = results or {}
    scores: dict[str, int | None] = {dim: None for dim in DIMENSION_IDS}

    for dim, fn in (
        ("vc", lambda p: score_vc(p.get("metrics"))),
        ("ps", lambda p: score_ps(p.get("metrics"))),
        ("sv", lambda p: score_sv(p.get("metrics"))),
        ("am", lambda p: score_am(p.get("metrics"), p.get("answers"))),
        ("vf", lambda p: score_vf(p.get("metrics"))),
        ("nc", lambda p: score_nc(p.get("metrics"))),
        ("ir", lambda p: score_ir(p.get("metrics"))),
        ("ni", lambda p: score_ni(p.get("metrics"))),
    ):
        payload = results.get(dim)
        if isinstance(payload, dict):
            scores[dim] = fn(payload)

    measured = [dim for dim in DIMENSION_IDS if scores[dim] is not None]
    missing = [dim for dim in DIMENSION_IDS if scores[dim] is None]
    return {
        "version": SCORING_VERSION,
        "scores": scores,
        "dimensions": scores,
        "measured": measured,
        "missing": missing,
    }


__all__ = [
    "CONFIG",
    "DIMENSION_IDS",
    "SCORING_VERSION",
    "score_session",
    "score_am",
    "score_ir",
    "score_nc",
    "score_ni",
    "score_ps",
    "score_sv",
    "score_vc",
    "score_vf",
    "sv_median_rt",
]
