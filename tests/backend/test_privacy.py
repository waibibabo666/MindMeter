"""Pure (no database) checks for the safety layer."""
from __future__ import annotations

from app.agent import classify
from app.privacy import find_sensitive, redact


def test_find_sensitive_detects_phone_id_and_email():
    assert find_sensitive("我的手机号是 13800138000") == ["手机号"]
    assert find_sensitive("身份证 110101199003071234") == ["身份证号"]
    assert find_sensitive("邮箱 me@example.com") == ["邮箱"]
    assert find_sensitive("言语理解正确 5/8") == []


def test_redact_replaces_placeholders():
    text = redact("手机 13800138000，身份证 110101199003071234，邮箱 me@example.com")
    assert "13800138000" not in text
    assert "110101199003071234" not in text
    assert "me@example.com" not in text
    assert "[手机号已隐藏]" in text
    assert "[身份证号已隐藏]" in text
    assert "[邮箱已隐藏]" in text


def test_classify_routes_crisis_boundary_and_high_domain():
    assert classify("我不想活了，感觉活着没意思")["intent"] == "crisis"
    assert classify("我是不是得了抑郁症，要吃什么药？")["intent"] == "boundary"
    # A4：金融/法律类此前没有任何边界话术，会落到普通解释流程。
    assert classify("我想把年终奖全投进朋友推荐的基金")["intent"] == "high_domain"
    assert classify("朋友借钱不还，我可以起诉他吗")["intent"] == "high_domain"


def test_classify_keeps_domain_questions_out_of_boundary_buckets():
    assert classify("为什么联想记忆低？")["intent"] == "explain"
    assert classify("今天天气怎么样？")["intent"] == "unrelated"
