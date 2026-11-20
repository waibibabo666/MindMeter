"""Shared trend assembly (pure functions).

One implementation for the comparison of the last two completed assessments,
used by both `GET /trends` (table rendering) and the Agent facts assembler, so
the model can quote deltas that live in the same whitelist the validator reads.
See docs/software/agent-trend-workflow.md §6.1.
"""
from __future__ import annotations

from typing import Any

from .templates import DIM_NAMES, DIM_ORDER

REPEAT_MIN_DAYS = 7  # keep in sync with frontend src/trend.js REPEAT_MIN_DAYS


def _scores(session: dict) -> dict[str, int]:
    return {
        dim: score
        for dim, score in (session.get("scores") or {}).items()
        if isinstance(score, int)
    }


def _finished_at(session: dict) -> str:
    return str(session.get("finishedAt") or "")


def days_between(prev_at: str, next_at: str) -> int | None:
    from .timeutil import parse_dt

    a = parse_dt(prev_at)
    b = parse_dt(next_at)
    if not a or not b:
        return None
    return int(abs((b - a).total_seconds()) // 86400)


def build_trend_from_sessions(prev: dict, next_: dict) -> dict[str, Any]:
    """Compare only dimensions scored in both sessions; carry delta + gap."""
    prev_scores = _scores(prev)
    next_scores = _scores(next_)
    common = [dim for dim in DIM_ORDER if dim in prev_scores and dim in next_scores]
    rows = [
        {
            "id": dim,
            "name": DIM_NAMES.get(dim, dim),
            "prev": prev_scores[dim],
            "next": next_scores[dim],
            "delta": next_scores[dim] - prev_scores[dim],
        }
        for dim in common
    ]
    days = days_between(_finished_at(prev), _finished_at(next_))
    return {
        "prevId": prev.get("id"),
        "nextId": next_.get("id"),
        "rows": rows,
        "onlyPrev": [dim for dim in prev_scores if dim not in common],
        "onlyNext": [dim for dim in next_scores if dim not in common],
        "days": days,
        "repeatRisk": days is not None and days < REPEAT_MIN_DAYS,
    }


def build_trend_payload(sessions: list[dict]) -> dict[str, Any] | None:
    """`sessions` newest-first (as returned by sessions_payload). None if <2."""
    if not isinstance(sessions, list) or len(sessions) < 2:
        return None
    return build_trend_from_sessions(sessions[1], sessions[0])
