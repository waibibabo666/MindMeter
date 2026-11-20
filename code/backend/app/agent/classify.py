"""意图分类与会场话术：不导入 llm / rag / graph 的叶子模块。

为什么单独成模块（2026-11-20 用户实测第 5 条根因）：

1. `api/chat.py` 的记忆沉淀也要用这套词汇（话题、维度、建议口径）。词汇如果留在
   `agent/__init__.py`，`insights → agent/__init__ → llm/rag/langgraph` 会把沉淀
   这条轻路径拖成一整张图，还构成循环导入；
2. 分类是纯字符串逻辑，可单测、可离线复用，本就该和"图"分开。

对外符号（INTENT / FIXED_REPLY / classify …）由 `agent/__init__.py` 原样 re-export，
现有测试与调用方的 import 名不变。**词汇与规则只在这里定义一次，不要两头维护。**
"""
from __future__ import annotations

import re

from ..templates import DIM_NAMES, DIM_ORDER
from .policies import SCOPE_BACKFILL  # noqa: F401 - 固定声明句归 policies（与 SCOPE_MARKERS 同源）

INTENT = {
    "EXPLAIN": "explain",
    "CLARIFY": "clarify",
    "UNRELATED": "unrelated",
    "BOUNDARY": "boundary",
    "CRISIS": "crisis",
    "TREND": "trend",
    "SELF_BLAME": "self_blame",
    "TREND_NO_DATA": "trend_no_data",
    "SUPPORT": "support",
    "HIGH_DOMAIN": "high_domain",
    "SUMMARY": "summary",
    "GREETING": "greeting",
}

RISK_BY_INTENT = {
    INTENT["CRISIS"]: "high",
    INTENT["BOUNDARY"]: "high",
    INTENT["HIGH_DOMAIN"]: "high",
    INTENT["SUPPORT"]: "medium",
    INTENT["UNRELATED"]: "low",
    INTENT["CLARIFY"]: "low",
    INTENT["EXPLAIN"]: "low",
    INTENT["TREND"]: "low",
    INTENT["SELF_BLAME"]: "low",
    INTENT["TREND_NO_DATA"]: "low",
    INTENT["SUMMARY"]: "low",
    INTENT["GREETING"]: "low",
}

CRISIS_WORDS = ["自杀", "自伤", "自残", "不想活", "活不下去", "结束生命", "伤害自己", "轻生", "绝望"]
BOUNDARY_WORDS = [
    "抑郁症",
    "抑郁",
    "焦虑症",
    "多动症",
    "ADHD",
    "自闭症",
    "精神病",
    "确诊",
    "诊断",
    "吃药",
    "药物",
    "用药",
    "治疗",
    "有病",
]
DIMENSION_WORDS = [
    "言语理解",
    "言语流畅",
    "数字运算",
    "知觉速度",
    "归纳推理",
    "空间视觉",
    "联想记忆",
    "自然探索",
]
DOMAIN_WORDS = [
    *DIMENSION_WORDS,
    "分数",
    "得分",
    "报告",
    "测评",
    "任务",
    "记忆",
    "建议",
    "练习",
    "总分",
    "档位",
    "未测",
]
EXPLAIN_WORDS = [
    "为什么",
    "怎么",
    "哪项",
    "哪一项",
    "什么意思",
    "解释",
    "原因",
    "建议",
    "练",
    "提高",
    "低",
    "高",
    "差",
    "提升",
    "怎么看",
]
HIGH_DOMAIN_WORDS = [
    "起诉",
    "法律",
    "律师",
    "投资",
    "股票",
    "基金",
    "贷款",
    "借钱",
    "黑客",
    "漏洞",
    "绕过",
    "违法",
    "安全风险",
]
SUPPORT_WORDS = [
    "压力",
    "睡不着",
    "失眠",
    "情绪低落",
    "难受",
    "崩溃",
    "疲惫",
    "很累",
]
SUMMARY_PHRASES = [
    "我的认知",
    "认知怎么样",
    "我的能力",
    "能力怎么样",
    "我的结果",
    "结果怎么样",
    "表现怎么样",
    "表现如何",
    "整体怎么样",
    "整体表现",
    "水平怎么样",
    "强项",
    "弱项",
    "短板",
    "总体",
]
# 寒暄词。注意：它**不是**一条硬意图路由（见 classify 里的说明）。
GREETING_WORDS = ["你好", "您好", "hello", "hi", "嗨", "哈喽", "在吗", "在么", "早上好", "晚上好"]
# 只有寒暄与标点时才算"纯打招呼"。
POLITE_FILLERS = ["呀", "啊", "哦", "呢", "嘛", "哇", "吧", "拉"]
ADVICE_PHRASES = [
    "给点建议",
    "给些建议",
    "有什么建议",
    "有啥建议",
    "下一步怎么办",
    "下一步怎么练",
    "下一步做什么",
    "下一步怎么走",
    "怎么提升",
    "如何提升",
    "该练什么",
    "练什么",
    "先做什么",
    "该做什么",
    "怎么安排",
    "如何安排",
]
UNRELATED_WORDS = [
    "天气",
    "股票",
    "基金",
    "翻译",
    "笑话",
    "写代码",
    "帮我写",
    "作文",
    "做饭",
    "电影",
    "游戏推荐",
    "旅游",
]
# 趋势触发词：强词单独出现即可路由；弱词必须与维度名/分数语境同现，
# 避免「上次那个建议怎么还没做」这类跟进句被误读成趋势解释。
TREND_STRONG_WORDS = ["趋势", "对比", "比较", "变化", "复测", "差多少", "有什么不一样"]
TREND_WEAK_WORDS = ["上次", "涨跌"]
TREND_CONTEXT_WORDS = [*DIMENSION_WORDS, "分数", "得分", "这次", "两次", "复测"]
# 自责重导向（ADR-0002 决策 6）：主语与贬义 6 字窗内共现才触发，
# 「这个方法没用」这类指向物的句子不触发。
SELF_BLAME_RE = re.compile(
    r"(?:我|自己)[^，,。;；！!？?\s]{0,6}(?:笨|蠢|废物|没用|脑子不行|脑子坏了)"
)

FIXED_REPLY = {
    INTENT["CLARIFY"]: "你指的是哪一项？可以说出维度名，比如「联想记忆」，我再解释。",
    INTENT["UNRELATED"]: "我只解释本次测评的结果。你可以问某个维度为什么低、或者下一步怎么练。",
    INTENT["BOUNDARY"]: "我不能判断疾病、也不能给用药或治疗建议。如果你担心自己的状态，请咨询医生或学校心理中心。",
    INTENT["CRISIS"]: "听到你这么说我很在意。请先联系身边的人，或拨打全国统一心理援助热线 12356。如果你现在有危险，请立即拨打 120。",
    INTENT["SELF_BLAME"]: (
        "这句话不是测评能得出的结论。我能说的是这次任务的条件：题目形式、限时方式、上一题的影响。"
        "想拆开看哪一部分，可以说一个维度名，比如『联想记忆』。"
    ),
    INTENT["TREND_NO_DATA"]: "这个账号还没有两次可比的测评。完成一次标准测评后，这里才能解释变化。",
    INTENT["SUPPORT"]: (
        "听起来你最近状态不太好。先保证休息和基本作息，找信任的人说一说；"
        "如果这种状态持续两周以上或已经影响学习生活，建议联系学校心理中心或医生。"
        "我不能做诊断，也不会用一次测评给你下结论。"
    ),
    INTENT["HIGH_DOMAIN"]: (
        "这涉及法律、金融或安全方面的专业判断，我不能给这类建议，也不会用测评结果推断。"
        "请咨询持证专业人士；如果存在紧急人身或财产安全风险，请联系当地紧急服务。"
    ),
    INTENT["GREETING"]: "你好，我是 MindMeter 的解读助手。你可以直接问「我的认知怎么样」，或问某个维度为什么低、下一步怎么练。",
}

# 没有可解读结果时的寒暄口径（能力边界先说清，A1）。
GREETING_NO_FACTS = (
    "你好，我是 MindMeter 的解读助手。这里只解释你这次测评的原始指标，"
    "所以先完成一次测评，之后可以问「我的认知怎么样」，或问某个维度为什么低、下一步怎么练。"
)

NO_KNOWLEDGE_REPLY = (
    "本地知识库里没有能直接回答这个问题的内容，我不猜。"
    "你可以换个问法（比如「联想记忆怎么练」），或查看报告里的原始指标。"
)

# 用户口中的维度名 → 维度 id（长短两种写法都收）。
DIM_WORD_TO_ID = {
    "言语理解": "vc",
    "言语流畅性": "vf",
    "言语流畅": "vf",
    "数字运算": "nc",
    "知觉速度": "ps",
    "归纳推理": "ir",
    "空间视觉化": "sv",
    "空间视觉": "sv",
    "联想记忆": "am",
    "自然探索": "ni",
}
# 问的是"下一步做什么"，不是"这个数字怎么读"——兜底模板必须换成建议口径。
ADVICE_ASK_WORDS = [
    "建议",
    "下一步",
    "明天",
    "接下来",
    "怎么练",
    "练什么",
    "该练",
    "提升",
    "提高",
    "怎么办",
    "测什么",
    "先做",
    "怎么安排",
    "安排",
]

_PUNCT_RE = re.compile(r"[\s，,。.！!？?~～、;；:：\"'“”‘’()（）【】\[\]]+")


def normalize(text: str) -> str:
    """大小写归一 + 去空白标点：「HI，我的认知怎么样」==「我的认知怎么样」。"""
    return _PUNCT_RE.sub("", str(text or "").lower())


def hits(text: str, words: list[str]) -> list[str]:
    """子串命中（大小写不敏感，比较两边都归一，别只把问题 lower 而词表里有大写词）。"""
    lowered = str(text or "").lower()
    return [word for word in words if word.lower() in lowered]


def dims_in_question(question: str) -> list[str]:
    """问题里点名的维度（按 DIM_ORDER 固定顺序去重）。"""
    lowered = normalize(question)
    found = {dim for word, dim in DIM_WORD_TO_ID.items() if word in lowered}
    return [dim for dim in DIM_ORDER if dim in found]


def is_advice_ask(question: str) -> bool:
    lowered = normalize(question)
    if not lowered:
        return False
    return any(word in lowered for word in ADVICE_ASK_WORDS)


def strip_greetings(text: str) -> str:
    """剥掉开头/结尾的寒暄词与语气词，看这句话还剩什么。"""
    value = normalize(text)
    changed = True
    while changed:
        changed = False
        for word in GREETING_WORDS:
            if value.startswith(word):
                value = value[len(word) :]
                changed = True
        for word in POLITE_FILLERS:
            # 允许整句只剩一个语气词的情况："你好呀" 剥完应当变成空。
            if value.endswith(word):
                value = value[: -len(word)]
                changed = True
    return value


def greeting_only(question: str) -> bool:
    """纯寒暄（"你好"、"HI！"、"在吗 你好"）才算；带任何内容就不是。"""
    rest = strip_greetings(question)
    if rest:
        return False
    return bool(hits(str(question or ""), GREETING_WORDS))


def conversation_topic(question: str, facts: dict | None = None) -> str:
    """摘要里的"本次对话主题"：只描述问题点到的维度与问法，不复述用户原句。

    不复述原句是刻意的：摘要会进记忆面板、也会进导出文件，把一次性追问抄成
    长期档案等于扩大了留存范围（用户测试表 A7 隐私透明）。
    """
    text = str(question or "")
    named = [DIM_NAMES.get(dim, dim) for dim in dims_in_question(text)]
    if named:
        return "、".join(dict.fromkeys(named))
    lowered = normalize(text)
    if any(word in lowered for word in TREND_STRONG_WORDS) or "上次" in lowered:
        return "两次测评的差异"
    if is_advice_ask(text):
        return "下一步怎么安排"
    if any(phrase in lowered for phrase in SUMMARY_PHRASES):
        return "这次结果的整体读法"
    if facts:
        return "这次测评的结果"
    return "测评结果怎么读"


def classify(question: str) -> dict:
    raw = str(question or "").strip()
    if not raw:
        return {"intent": INTENT["CLARIFY"], "matched": [], "reason": "empty"}
    # 归一化一次并复用（此前 text 是 strip 过的原样，既没 lower 也没去标点，
    # "HI，我的认知怎么样" 因此漏判成 clarify）。
    text = normalize(raw)
    explain = hits(text, EXPLAIN_WORDS)
    domain = hits(text, DOMAIN_WORDS)
    unrelated = hits(text, UNRELATED_WORDS)

    matched = hits(text, CRISIS_WORDS)
    if matched:
        return {"intent": INTENT["CRISIS"], "matched": matched, "reason": "crisis-word"}
    matched = hits(text, BOUNDARY_WORDS)
    if matched:
        return {"intent": INTENT["BOUNDARY"], "matched": matched, "reason": "medical-word"}
    matched = hits(text, HIGH_DOMAIN_WORDS)
    if matched:
        return {"intent": INTENT["HIGH_DOMAIN"], "matched": matched, "reason": "high-domain-word"}
    blame = SELF_BLAME_RE.search(text)
    if blame:
        return {"intent": INTENT["SELF_BLAME"], "matched": [blame.group(0)], "reason": "self-blame"}
    matched = hits(text, SUPPORT_WORDS)
    if matched:
        return {"intent": INTENT["SUPPORT"], "matched": matched, "reason": "support-word"}
    if any(phrase in text for phrase in ADVICE_PHRASES):
        return {"intent": INTENT["SUMMARY"], "matched": [], "reason": "advice-question"}
    if unrelated and not domain:
        return {"intent": INTENT["UNRELATED"], "matched": unrelated, "reason": "off-topic"}
    trend = hits(text, TREND_STRONG_WORDS)
    if trend or (hits(text, TREND_WEAK_WORDS) and hits(text, TREND_CONTEXT_WORDS)):
        return {
            "intent": INTENT["TREND"],
            "matched": [*trend, *hits(text, TREND_WEAK_WORDS)],
            "reason": "trend-word",
        }
    if any(phrase in text for phrase in SUMMARY_PHRASES):
        return {"intent": INTENT["SUMMARY"], "matched": [], "reason": "summary-question"}

    # GREETING 降级为"没有其它业务信号时的收尾"，不再插在 domain 之前当硬路由：
    # 「你好，我想提分」曾被这条分支吃掉，回成"你可以问我你的认知怎么样"。
    if greeting_only(text):
        return {
            "intent": INTENT["GREETING"],
            "matched": hits(text, GREETING_WORDS),
            "reason": "greeting-only",
        }

    # 有领域词或有意义的解释诉求 → explain；否则先澄清。
    # 旧的 `len(text) <= 8` 短问句规则在归一化后会误伤「如何提高编程能力」（刚好 8 字），
    # 而那句其实有"提高"这个明确信号，判成 clarify 反而更让人不满意。
    strong_explain = [word for word in explain if len(word) >= 2]
    if domain or strong_explain:
        return {
            "intent": INTENT["EXPLAIN"],
            "matched": [*domain, *strong_explain],
            "reason": "domain-question",
        }
    return {"intent": INTENT["CLARIFY"], "matched": explain, "reason": "no-domain-no-signal"}


def fixed_reply(intent: str) -> str:
    return FIXED_REPLY.get(intent, FIXED_REPLY[INTENT["UNRELATED"]])
