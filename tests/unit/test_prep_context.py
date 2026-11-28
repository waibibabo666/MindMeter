"""测评前临场状态（睡眠/疲劳）：白名单、落库与提示词。"""

from app.agent.render import build_messages
from app.api.assessments import _clean_prep


def test_prep_whitelist_keeps_only_valid_fields():
    assert _clean_prep({"sleep": 5, "fatigue": 4}) == {"sleep": 5, "fatigue": 4}
    assert _clean_prep({"sleep": "5", "fatigue": 9}) == {}
    assert _clean_prep({"sleep": -1, "fatigue": 0}) == {}
    assert _clean_prep(None) == {}
    assert _clean_prep({"foo": "bar"}) == {}


def test_prompt_contains_prep_state():
    facts = {
        "am": {"targets": 6, "firstTry": 5, "errors": 1, "score": 80},
        "prep": {"sleep": 5, "fatigue": 4},
    }
    messages = build_messages("联想记忆这项测什么？", facts, [], [], None)
    content = messages[-1]["content"]
    assert "临场状态" in content
    assert "睡眠 5 小时" in content
    assert "疲劳 4/5" in content
