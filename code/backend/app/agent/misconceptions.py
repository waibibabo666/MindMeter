"""概念纠偏：用户可能误解了测评口径时，给一句确定性纠正（不调用模型）。

约束（产品要求）：
  * 只纠正"高置信、常见"的误解，不说教、不展开；
  * **一次对话最多纠正 2 次**，同一个误解不重复纠正，超出就正常回答；
  * 文案短（一句纠正 + 一句能做什么），带一条真实知识块引用；
  * 全程不调用模型 —— 纠正本身就省 token。
"""
from __future__ import annotations

import re

CORRECTION_PREFIX = "先澄清一个概念："
MAX_CORRECTIONS = 2

# (匹配, 纠正文案, 知识块 id)
RULES: list[tuple[re.Pattern[str], str, str]] = [
    (
        re.compile(r"八.{0,2}(?:个)?(?:维度|项).{0,3}(?:智力|智商)|八种智力"),
        "八个维度是八个任务方向，不等于八种智力，也不构成智力测验。",
        "kb-limit-02",
    ),
    (
        re.compile(r"(?:分数|得分).{0,6}(?:智商|聪明|智力水平)|我智商多少"),
        "分数只描述这次任务的表现，不是智商，也不与人群比较。",
        "kb-score-02",
    ),
    (
        re.compile(r"未测.{0,4}(?:0\s*分|零分|就是0)|没测.{0,4}(?:0\s*分|零分)"),
        "未测是这次没做这一项，不是 0 分，也不参与任何比较。",
        "kb-score-04",
    ),
    (
        re.compile(r"(?:一次|测一次).{0,8}(?:定|决定).{0,4}(?:水平|能力)|以后就这样了"),
        "一次结果只代表当天这次任务；要谈变化，需要隔一周以上、同一档位再测一次。",
        "kb-score-05",
    ),
    (
        re.compile(r"(?:这个|这次|这个测评).{0,4}(?:是|算).{0,2}(?:诊断|确诊|查病)"),
        "这不是诊断工具，也不判断疾病；它只记录任务里的表现。",
        "kb-limit-01",
    ),
]


def find_misconception(question: str) -> tuple[str, str] | None:
    """命中返回 (纠正文案, 知识块 id)，否则 None。"""
    text = str(question or "")
    for pattern, reply, kb_id in RULES:
        if pattern.search(text):
            return reply, kb_id
    return None


def correction_count(history: list | None) -> int:
    """数一次对话里已经纠正过几次（看助手消息里的固定前缀）。"""
    count = 0
    for item in history or []:
        if not isinstance(item, dict):
            continue
        if item.get("role") != "assistant":
            continue
        if CORRECTION_PREFIX in str(item.get("content") or ""):
            count += 1
    return count


def build_correction(reply: str, kb_id: str) -> str:
    return (
        f"{CORRECTION_PREFIX}{reply}"
        f"（引用：{kb_id}）\n\n"
        "想继续的话，可以直接问这项怎么读、或者下一步怎么练。"
    )


def should_correct(question: str, history: list | None) -> tuple[str, str] | None:
    """受次数上限约束的入口：超过上限、或这次不需要纠正时返回 None。"""
    if correction_count(history) >= MAX_CORRECTIONS:
        return None
    return find_misconception(question)
