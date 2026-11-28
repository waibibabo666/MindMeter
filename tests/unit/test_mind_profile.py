"""心智画像：每条描述必须有读数依据，且不越过诊断/量表红线。"""
from app.agent.mind_profile import build_mind_profile, profile_block
from app.agent.policies import policy_for
from app.agent.validation import banned_word_hits, derived_allowed_numbers, validate_text

FACTS = {
    "vc": {"correct": 6, "total": 6, "score": 90},
    "ps": {"encCorrect": 12, "encWrong": 0, "catCorrect": 9, "catWrong": 0, "score": 55},
    "am": {"firstTry": 2, "targets": 8, "errors": 6, "score": 30},
}


def test_empty_facts_gives_no_profile():
    assert build_mind_profile({})["lines"] == []
    assert profile_block({}) == ""


def test_profile_names_top_and_bottom_dimension_with_their_scores():
    lines = "\n".join(build_mind_profile(FACTS)["lines"])
    assert "言语理解（参考分 90）最突出" in lines
    assert "联想记忆（参考分 30）相对靠后" in lines


def test_style_notes_come_from_raw_metrics():
    styles = build_mind_profile(FACTS)["styles"]
    assert "先准再快" in styles["ps"]
    assert "重试" in styles["am"]


def test_profile_uses_only_numbers_from_facts_and_no_clinical_words():
    text = profile_block(FACTS)
    assert not banned_word_hits(text)
    result = validate_text(
        text + "这些数字不能说明能力高低。",
        allowed_numbers=derived_allowed_numbers(FACTS),
        policy={**policy_for("summary"), "max_chars": 2000, "require_citation": "off"},
    )
    hard = [i for i in result["issues"] if i["severity"] == "hard"]
    assert not hard, hard


def test_trend_line_warns_about_practice_effect_when_interval_short():
    facts = {
        **FACTS,
        "trend": {
            "rows": [{"id": "am", "name": "联想记忆", "prev": 20, "next": 30, "delta": 10}],
            "repeatRisk": True,
            "days": 2,
        },
    }
    lines = "\n".join(build_mind_profile(facts)["lines"])
    assert "练习效应" in lines and "上升 10" in lines
