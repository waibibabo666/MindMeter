"""趋势组装（纯函数）与趋势模板兜底的测试。对应设计文档 §六 1/4、§九 2。"""
from __future__ import annotations

from app.templates import template_trend
from app.trend import REPEAT_MIN_DAYS, build_trend_from_sessions, build_trend_payload


def session(assessment_id, finished_at, **scores):
    return {
        "id": assessment_id,
        "finishedAt": finished_at,
        "scores": {dim: value for dim, value in scores.items()},
    }


def test_common_dimensions_only_with_delta_and_days():
    prev = session("s1", "2026-10-01T01:00:00Z", vc=60, ps=38, sv=None, am=44)
    next_ = session("s2", "2026-10-10T01:00:00Z", vc=65, ps=38, sv=71, am=None)
    payload = build_trend_from_sessions(prev, next_)
    ids = [row["id"] for row in payload["rows"]]
    assert ids == ["vc", "ps"]
    row = payload["rows"][0]
    assert row["name"] == "言语理解" and row["delta"] == 5
    assert payload["onlyPrev"] == ["am"] and payload["onlyNext"] == ["sv"]
    assert payload["days"] == 9
    assert payload["repeatRisk"] is False


def test_repeat_risk_flag_within_seven_days():
    prev = session("s1", "2026-10-01T00:00:00Z", vc=60)
    next_ = session("s2", "2026-10-05T12:00:00Z", vc=61)
    payload = build_trend_from_sessions(prev, next_)
    assert payload["days"] == 4
    assert payload["repeatRisk"] is True
    assert REPEAT_MIN_DAYS == 7


def test_payload_requires_two_sessions():
    assert build_trend_payload([]) is None
    assert build_trend_payload([session("s1", "2026-10-01T00:00:00Z", vc=1)]) is None
    two = [
        session("s2", "2026-10-10T00:00:00Z", vc=65),
        session("s1", "2026-10-01T00:00:00Z", vc=60),
    ]
    payload = build_trend_payload(two)
    assert payload["prevId"] == "s1" and payload["nextId"] == "s2"


def test_template_trend_lists_rows_and_scope_note():
    text = template_trend({
        "rows": [
            {"id": "am", "name": "联想记忆", "prev": 44, "next": 51, "delta": 7},
            {"id": "ps", "name": "知觉速度", "prev": 38, "next": 38, "delta": 0},
        ],
        "onlyPrev": ["sv"],
        "onlyNext": [],
        "days": 9,
        "repeatRisk": False,
    })
    assert "联想记忆 44 → 51（+7）" in text
    assert "知觉速度 38 → 38（持平）" in text
    assert "间隔 9 天" in text
    assert "空间视觉" in text  # 未参与对比的维度要说明
    for banned in ("进步", "退步", "诊断", "总分"):
        assert banned not in text
    assert "不与人群比较" in text or "非常模" in text or "单次" in text


def test_template_trend_repeat_risk_hint():
    text = template_trend({
        "rows": [{"id": "vc", "name": "言语理解", "prev": 60, "next": 66, "delta": 6}],
        "onlyPrev": [],
        "onlyNext": [],
        "days": 4,
        "repeatRisk": True,
    })
    assert "练习效应" in text and "少于 7 天" in text


def test_template_trend_empty_payloads_have_copy():
    assert "还没有两次可比" in template_trend(None)
    assert "还没有两次可比" in template_trend({"rows": []})
