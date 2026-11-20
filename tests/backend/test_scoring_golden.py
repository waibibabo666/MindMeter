"""Golden scoring cases, shared with the JS engine.

Numbers here are the same ones `scripts/test_scoring.js` asserts against
`src/scoring/index.js`. If a formula changes on one side, the other side's
suite (and `test_matches_the_js_engine` below) fails.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from app.scoring import DIMENSION_IDS, SCORING_VERSION, score_session


def answers(old: int, new: int) -> list[dict]:
    return [{"isOld": True}] * old + [{"isOld": False}] * new


def rts(count: int, value: int) -> list[int]:
    return [value] * count


def standard_results() -> dict:
    return {
        "vc": {"metrics": {"total": 8, "correct": 8}, "answers": []},
        "ps": {"metrics": {"correct": 24}, "answers": []},
        "sv": {"metrics": {"total": 8, "correct": 8, "correctRts": rts(8, 1500)}, "answers": []},
        "am": {"metrics": {"hits": 8, "falseAlarms": 0}, "answers": answers(8, 8)},
    }


def test_all_correct():
    scores = score_session(standard_results(), "standard")["scores"]
    assert scores["vc"] == 100
    assert scores["ps"] == 100
    assert scores["sv"] == 100
    assert scores["am"] == 84  # d' = 3.186


def test_medium():
    results = {
        "vc": {"metrics": {"total": 8, "correct": 5}},
        "ps": {"metrics": {"correct": 14}},
        "sv": {"metrics": {"total": 8, "correct": 6, "correctRts": rts(6, 2500)}},
        "am": {"metrics": {"hits": 6, "falseAlarms": 2}, "answers": answers(8, 8)},
    }
    scores = score_session(results, "standard")["scores"]
    assert scores == {"vc": 50, "vf": None, "nc": None, "ps": 38, "ir": None, "sv": 71, "am": 44, "ni": None}


def test_low():
    results = {
        "vc": {"metrics": {"total": 8, "correct": 3}},
        "ps": {"metrics": {"correct": 9}},
        "sv": {"metrics": {"total": 8, "correct": 4, "correctRts": rts(4, 3800)}},
        "am": {"metrics": {"hits": 3, "falseAlarms": 5}, "answers": answers(8, 8)},
    }
    scores = score_session(results, "standard")["scores"]
    assert scores["vc"] == 17  # 猜测校正后 3/8 → 17，不是 38
    assert scores["ps"] == 6
    assert scores["sv"] == 37
    assert scores["am"] == 9


def test_zero_is_not_null():
    results = {
        "vc": {"metrics": {"total": 8, "correct": 0}},
        "ps": {"metrics": {"correct": 8}},
        "am": {"metrics": {"hits": 0, "falseAlarms": 8}, "answers": answers(8, 8)},
    }
    scores = score_session(results, "standard")["scores"]
    assert scores["vc"] == 0
    assert scores["ps"] == 0
    assert scores["am"] == 0


def test_untested_are_null_and_no_total():
    result = score_session({}, "standard")
    assert result["measured"] == []
    assert result["missing"] == DIMENSION_IDS
    assert all(result["scores"][dim] is None for dim in DIMENSION_IDS)
    assert "total" not in result
    assert "percentile" not in result


# ---------------------------------------------------------------------------
# 分档题量：这是 v3.1 端口漏掉的部分，nc/ir/ni 曾因写死 20/15/20 而恒为 null
# ---------------------------------------------------------------------------


def test_standard_tier_counts_the_delivered_items():
    results = {
        "nc": {"metrics": {"total": 10, "correct": 10}},
        "ir": {"metrics": {"total": 8, "correct": 8}},
        "ni": {"metrics": {"total": 8, "correct": 8}},
    }
    scores = score_session(results, "standard")["scores"]
    assert (scores["nc"], scores["ir"], scores["ni"]) == (100, 100, 100)


def test_quick_and_deep_use_their_own_denominators():
    quick = score_session({"vc": {"metrics": {"total": 4, "correct": 4}}}, "quick")["scores"]
    assert quick["vc"] == 100
    # 同一份 4 题作答放在标准档（8 题）里就是完成度不足，必须记 null
    standard = score_session({"vc": {"metrics": {"total": 4, "correct": 4}}}, "standard")["scores"]
    assert standard["vc"] is None
    deep = score_session({"vc": {"metrics": {"total": 12, "correct": 6}}}, "deep")["scores"]
    assert deep["vc"] == 33  # (0.5 - 0.25) / 0.75


def test_unknown_level_falls_back_to_standard():
    results = {"nc": {"metrics": {"total": 10, "correct": 10}}}
    assert score_session(results, None)["scores"]["nc"] == 100
    assert score_session(results, "bogus")["scores"]["nc"] == 100


def test_timed_dimensions_scale_by_seconds():
    # 30 秒说 10 个有效词，折算到 60 秒锚点是 20 个 → 50 分
    quick = score_session({"vf": {"metrics": {"validCount": 10}}}, "quick")["scores"]
    assert quick["vf"] == 50
    standard = score_session({"vf": {"metrics": {"validCount": 20}}}, "standard")["scores"]
    assert standard["vf"] == 50
    blocked = score_session({"vf": {"metrics": {"validCount": 20, "unavailable": True}}}, "standard")
    assert blocked["scores"]["vf"] is None


def test_new_metric_paths_are_scored():
    """sv 的加权正确率、am 的 PAL 口径、ps 的编码/分类双段。"""
    scores = score_session(
        {
            "sv": {"metrics": {"total": 8, "weighted": 8}},
            "am": {"metrics": {"targets": 12, "firstTry": 12}},
            "ps": {"metrics": {"encCorrect": 30, "encWrong": 0, "catCorrect": 30, "catWrong": 0}},
        },
        "standard",
    )["scores"]
    assert scores["sv"] == 100
    assert scores["am"] == 100
    assert scores["ps"] == 100


def test_scoring_version_is_reported():
    assert SCORING_VERSION == "scoring-v3.2"
    assert score_session({}, "standard")["version"] == SCORING_VERSION


# ---------------------------------------------------------------------------
# 跨引擎一致性：同一份输入，Python 与 JS 必须逐维相等
# ---------------------------------------------------------------------------

FIXTURES = [
    ("standard", standard_results()),
    (
        "standard",
        {
            "vc": {"metrics": {"total": 8, "correct": 5}},
            "nc": {"metrics": {"total": 10, "correct": 7}},
            "ir": {"metrics": {"total": 8, "correct": 4}},
            "ni": {"metrics": {"total": 8, "correct": 6}},
            "sv": {"metrics": {"total": 8, "correct": 6, "correctRts": rts(6, 2500)}},
            "am": {"metrics": {"hits": 6, "falseAlarms": 2}, "answers": answers(8, 8)},
            "ps": {"metrics": {"encCorrect": 12, "encWrong": 2, "catCorrect": 9, "catWrong": 1}},
            "vf": {"metrics": {"validCount": 18}},
        },
    ),
    (
        "quick",
        {
            "vc": {"metrics": {"total": 4, "correct": 3}},
            "nc": {"metrics": {"total": 6, "correct": 4}},
            "ir": {"metrics": {"total": 6, "correct": 2}},
            "ni": {"metrics": {"total": 6, "correct": 5}},
            "sv": {"metrics": {"total": 6, "correct": 4, "correctRts": rts(4, 2000)}},
            "am": {"metrics": {"hits": 4, "falseAlarms": 1}, "answers": answers(4, 4)},
            "ps": {"metrics": {"correct": 10}},
            "vf": {"metrics": {"validCount": 8}},
        },
    ),
    (
        "deep",
        {
            "vc": {"metrics": {"total": 12, "correct": 9}},
            "sv": {"metrics": {"total": 12, "weighted": 9}},
            "ps": {"metrics": {"correct": 40}},
            "am": {"metrics": {"targets": 12, "firstTry": 9}},
            "vf": {"metrics": {"validCount": 30}},
        },
    ),
]

_JS_SNIPPET = """
const path = require('node:path');
const { pathToFileURL } = require('node:url');
(async () => {
  const href = (p) => pathToFileURL(path.resolve(p)).href;
  const scoring = await import(href('code/frontend/src/scoring/index.js'));
  const cases = JSON.parse(process.argv[2]);
  const out = cases.map(([level, results]) => scoring.scoreSession(results, level).dimensions);
  process.stdout.write(JSON.stringify(out));
})();
"""


@pytest.mark.skipif(shutil.which("node") is None, reason="node not available")
def test_matches_the_js_engine(tmp_path):
    root = Path(__file__).resolve().parents[2]
    script = tmp_path / "parity.cjs"
    script.write_text(_JS_SNIPPET, encoding="utf-8")
    payload = json.dumps([[level, results] for level, results in FIXTURES])
    result = subprocess.run(
        ["node", str(script), payload],
        cwd=str(root),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr[-800:]
    expected = json.loads(result.stdout)
    for (level, results), js_scores in zip(FIXTURES, expected, strict=True):
        py_scores = score_session(results, level)["scores"]
        assert py_scores == js_scores, f"level={level} py={py_scores} js={js_scores}"
