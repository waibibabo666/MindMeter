"""Golden scoring cases ported from the frozen JS scoring-v3.1 suite."""
from __future__ import annotations

from app.scoring import DIMENSION_IDS, score_session


def answers(old: int, new: int) -> list[dict]:
    return [{"isOld": True}] * old + [{"isOld": False}] * new


def test_all_correct():
    result = score_session(
        {
            "vc": {"metrics": {"total": 6, "correct": 6}},
            "ps": {"metrics": {"correct": 24}},
            "sv": {"metrics": {"total": 8, "correct": 8, "correctRts": [1500] * 8}},
            "am": {"metrics": {"hits": 8, "falseAlarms": 0}, "answers": answers(8, 8)},
        }
    )
    assert result["scores"]["vc"] == 100
    assert result["scores"]["ps"] == 100
    assert result["scores"]["sv"] == 100
    assert result["scores"]["am"] == 84


def test_medium():
    result = score_session(
        {
            "vc": {"metrics": {"total": 6, "correct": 4}},
            "ps": {"metrics": {"correct": 14}},
            "sv": {"metrics": {"total": 8, "correct": 6, "correctRts": [2500] * 6}},
            "am": {"metrics": {"hits": 6, "falseAlarms": 2}, "answers": answers(8, 8)},
        }
    )
    assert result["scores"]["vc"] == 67
    assert result["scores"]["ps"] == 38
    assert result["scores"]["sv"] == 71
    assert result["scores"]["am"] == 44


def test_low():
    result = score_session(
        {
            "vc": {"metrics": {"total": 6, "correct": 2}},
            "ps": {"metrics": {"correct": 9}},
            "sv": {"metrics": {"total": 8, "correct": 4, "correctRts": [3800] * 4}},
            "am": {"metrics": {"hits": 3, "falseAlarms": 5}, "answers": answers(8, 8)},
        }
    )
    assert result["scores"]["vc"] == 33
    assert result["scores"]["ps"] == 6
    assert result["scores"]["sv"] == 37
    assert result["scores"]["am"] == 9


def test_untested_are_null_and_no_total():
    result = score_session({})
    assert result["measured"] == []
    assert result["missing"] == DIMENSION_IDS
    assert all(result["scores"][dim] is None for dim in DIMENSION_IDS)
    assert "total" not in result
    assert "percentile" not in result
