"""The single authoritative server-side scoring engine (scoring-v3.2).

`score_session(results, level)` must return exactly what
`code/frontend/src/scoring/index.js#scoreSession(results, level)` returns for
the same input: the report card shows the client-side number while the
database, the trend page, the memory summary and the Agent facts all read this
one. Any drift between the two is a user-visible contradiction, so
`tests/backend/test_scoring_golden.py` pins the shared golden values and
`scripts/test_scoring.js` pins the same numbers on the JS side.
"""
from __future__ import annotations

from .config import CONFIG, DIMENSION_IDS, LEVEL_SPEC, LEVELS, SCORING_VERSION, items_for, seconds_for, spec_for
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


def score_session(results: dict | None, level: str | None = "standard") -> dict:
    results = results or {}
    scores: dict[str, int | None] = {dim: None for dim in DIMENSION_IDS}

    def payload(dim: str) -> dict | None:
        value = results.get(dim)
        return value if isinstance(value, dict) else None

    for dim, compute in (
        ("vc", lambda p: score_vc(p.get("metrics"), items_for(level, "vc"))),
        ("ps", lambda p: score_ps(p.get("metrics"), seconds_for(level, "ps"))),
        ("sv", lambda p: score_sv(p.get("metrics"), items_for(level, "sv"))),
        # am 的 targets/foils 从逐题作答里数，与题量档位无关
        ("am", lambda p: score_am(p.get("metrics"), p.get("answers"))),
        ("vf", lambda p: score_vf(p.get("metrics"), seconds_for(level, "vf"))),
        ("nc", lambda p: score_nc(p.get("metrics"), items_for(level, "nc"))),
        ("ir", lambda p: score_ir(p.get("metrics"), items_for(level, "ir"))),
        ("ni", lambda p: score_ni(p.get("metrics"), items_for(level, "ni"))),
    ):
        task = payload(dim)
        if task is not None:
            scores[dim] = compute(task)

    measured = [dim for dim in DIMENSION_IDS if scores[dim] is not None]
    missing = [dim for dim in DIMENSION_IDS if scores[dim] is None]
    return {
        "version": SCORING_VERSION,
        "level": str(level or "standard"),
        "scores": scores,
        "dimensions": scores,
        "measured": measured,
        "missing": missing,
    }


__all__ = [
    "CONFIG",
    "DIMENSION_IDS",
    "LEVEL_SPEC",
    "LEVELS",
    "SCORING_VERSION",
    "items_for",
    "score_am",
    "score_ir",
    "score_nc",
    "score_ni",
    "score_ps",
    "score_session",
    "score_sv",
    "score_vc",
    "score_vf",
    "seconds_for",
    "spec_for",
    "sv_median_rt",
]
