"""丧亲与上下文追问：关键词之外的“接住人”回归测试。"""

import pytest

from app.agent.classify import INTENT, classify, support_followup


@pytest.mark.parametrize("question", ["我家死人了", "爷爷去世了", "刚参加完葬礼"])
def test_grief_gets_support_not_clarify(question):
    result = classify(question)
    assert result["intent"] == INTENT["SUPPORT"]
    assert "grief" in result["matched"]


def test_support_followup_uses_context():
    history = [
        {"role": "user", "content": "我家死人了"},
        {"role": "assistant", "content": "抱歉……", "code": "intent:support:grief"},
    ]
    # 上一轮是支持/哀伤话术时，短追问继续接住
    assert support_followup("我干的", history)
    # 明确问维度时仍然正常走建议/解释
    assert not support_followup("联想记忆怎么练", history)
    # 没有上下文时不乱接
    assert not support_followup("我干的", [])
    assert not support_followup("我干的", [{"role": "assistant", "content": "你好", "code": "intent:greeting"}])
