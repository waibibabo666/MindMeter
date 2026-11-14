"""Pure (no database) checks for the safety layer."""
from __future__ import annotations

from app.agent import classify
from app.privacy import contains_pii, redact_pii


def test_classify_routes_crisis_boundary_advice_and_unrelated():
    assert classify("我不想活了，感觉活着没意思")["intent"] == "crisis"
    assert classify("我是不是得了抑郁症，要吃什么药？")["intent"] == "boundary"
    assert classify("我想把年终奖全投进朋友推荐的基金")["intent"] == "advice"
    assert classify("今天天气怎么样？")["intent"] == "unrelated"
    assert classify("为什么联想记忆低？")["intent"] == "explain"


def test_classify_keeps_domain_questions_out_of_the_unrelated_bucket():
    # "股票" 属于禁答范围，但"分数"是产品内问题，不能被误判成 unrelated。
    assert classify("为什么我的分数这么低？")["intent"] == "explain"
    assert classify("基金怎么买")["intent"] == "advice"


def test_redact_pii_masks_phone_and_id_card():
    text = redact_pii("手机号 13812345678，身份证 110101199003071234")
    assert "13812345678" not in text
    assert "138****5678" in text
    assert "110101199003071234" not in text
    assert "110101" in text and "1234" in text


def test_redact_pii_leaves_normal_numbers_alone():
    text = "言语理解正确 5/8，知觉速度 45 秒完成 24 题"
    assert redact_pii(text) == text
    assert contains_pii(text) is False
    assert contains_pii("电话13812345678") is True
