"""Agent scene policies: one place for per-scenario generation & validation rules.

Replaces the previously scattered prompt constants (chat SYSTEM_PROMPT vs the
report explain prompt) with a base prompt plus per-scene segments, and gives
the validator a declarative policy instead of one-size-fits-all rules.
See docs/software/agent-trend-workflow.md §5.1 and docs/adr/0002 for rationale.
"""
from __future__ import annotations

# 场景 → 校验/生成策略。require_* 取值：hard | soft | off。
SCENE_POLICIES: dict[str, dict] = {
    "chat_explain": {
        "max_chars": 200,
        "require_citation": "soft",
        "require_scope_note": "soft",
        "extra_banned": [],
    },
    "trend": {
        "max_chars": 300,
        "require_citation": "soft",
        "require_scope_note": "soft",
        "extra_banned": ["进步", "退步"],
    },
    "summary": {
        "max_chars": 900,
        "require_citation": "soft",
        "require_scope_note": "soft",
        "extra_banned": [],
    },
    "report": {
        "max_chars": 900,
        "require_citation": "off",
        "require_scope_note": "soft",
        "extra_banned": [],
    },
}

DEFAULT_SCENE = "chat_explain"

# 诚实呈现声明的最小短语集（与 templates.py 的 CLOSINGS 同源，ADR-0002 决策 5）。
SCOPE_MARKERS = [
    "不与人群比较",
    "不与人比较",
    "非常模",
    "不是常模",
    "没有常模",
    "只反映本次",
    "只反映这次",
    "只代表本次",
    "仅反映本次",
    "仅作参考",
    "只作参考",
    "本次测得",
    "本次完成的原始指标",
    "不等于训练效果",
    "单次",
    "不能说明",
    "不能读成",
]

# 公共纪律只写一遍（原来 chat 与 report 各有一套 prompt）。
BASE_PROMPT = (
    "你是 MindMeter 的解读助手。"
    "只解释给定的本次原始指标，不推断能力高低，不下诊断，不与人群比较。"
    "不要出现“总分”“百分位”“正常/异常”“治疗”等词。"
    "不得将本方分数换算为 MoCA 或任何量表分值，也不得与量表分数做任何对比。"
    "不得对用户的智力、天赋、人格或“是不是有病”做任何判断，褒义的特质标签同样禁止。"
    "解释表现时只谈可动的任务条件（限时方式、题目形式、策略取舍、状态、练习效应），"
    "不做稳定的特质归因。"
    "提到数字时只能用给定指标里的数字，或其直接派生（百分比、差值、秒数换算）。"
    "回答要包含一句这些数字不能说明什么。"
    "如果提供了知识块，回答末尾另起一行写「引用：知识块编号 · 标题」。"
    "如果提供了用户画像或既往摘要，只用于调整详略、避免重复已给过的建议；"
    "其中出现的任何数字都不属于本次指标，不得引用。"
)

SCENE_PROMPTS: dict[str, str] = {
    "chat_explain": "用不超过 200 字回答用户问题。",
    "trend": (
        "用户问的是两次测评的变化。只描述共同维度里「上次 → 本次（差值）」的数值变化，"
        "以及未参与对比的维度；间隔少于 7 天时必须提醒练习效应。"
        "只说变了多少，不说进步、退步、变好、变差，不预测未来，不评价训练效果。"
        "不超过 300 字。"
    ),
    "summary": "结合本次指标与知识块，给出结果解读、两条具体建议和引用。",
    "report": (
        "结合本次指标与知识块，用平实的话说明这些数字怎么读，"
        "给两条具体建议，并说明它只是单次快照、不与任何人比较。"
    ),
}


def policy_for(scene: str) -> dict:
    return SCENE_POLICIES.get(scene or DEFAULT_SCENE, SCENE_POLICIES[DEFAULT_SCENE])


def prompt_for(scene: str) -> str:
    key = scene or DEFAULT_SCENE
    return BASE_PROMPT + SCENE_PROMPTS.get(key, SCENE_PROMPTS[DEFAULT_SCENE])
