"""报告模板解读（无模型兜底）的纯函数测试。"""

from __future__ import annotations

from app.templates import DIM_ORDER, template_narrative

FACTS = {
    "vc": {"total": 6, "correct": 5, "meanRtMs": 3800},
    "ps": {"seconds": 45, "trials": 16, "correct": 16, "wrong": 0},
    "sv": {"total": 8, "correct": 8},
    "am": {"hits": 5, "falseAlarms": 3},
}


def test_covers_measured_dimensions_and_unmeasured_note():
    text = template_narrative(FACTS)
    for name in ("言语理解", "知觉速度", "空间视觉化", "联想记忆"):
        assert name in text
    assert "本档未测" in text
    assert "不按 0 分计算" in text


def test_has_reading_and_suggestion_sections():
    text = template_narrative(FACTS)
    assert "可以试试" in text
    assert "kb-plan-01" in text  # 通用建议必须带知识库引用
    assert "虚报" in text  # 联想记忆的读法说明


def test_avoids_diagnosis_and_total_score_wording():
    text = template_narrative(FACTS)
    for banned in ("诊断", "总分", "百分位", "治疗"):
        assert banned not in text


def test_wording_varies_between_calls():
    first = template_narrative(FACTS)
    second = template_narrative(FACTS)
    assert first != second


def test_empty_facts_returns_explanation():
    assert template_narrative({}).strip()
    assert template_narrative(None).strip()


def test_unknown_dimensions_are_ignored():
    text = template_narrative({"vf": {"correct": 3}, **FACTS})
    assert "言语流畅性" in text  # 出现在「未测」列表里
    assert len(DIM_ORDER) == 8
