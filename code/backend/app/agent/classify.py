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
    # 内容红线：色情 / 暴力 / 政治（课程要求绝对限制）
    "BLOCKED": "blocked",
    # 与心智评估无关的工具类请求（跑代码、改文件、写脚本）
    "OFF_TASK": "off_task",
}

RISK_BY_INTENT = {
    INTENT["CRISIS"]: "high",
    INTENT["BOUNDARY"]: "high",
    INTENT["HIGH_DOMAIN"]: "high",
    INTENT["BLOCKED"]: "high",
    INTENT["SUPPORT"]: "medium",
    INTENT["OFF_TASK"]: "low",
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
    # 概念类问题：用户问"认知心理学/工作记忆"时不该回"你指的是哪一项"。
    "认知",
    "认知心理学",
    "工作记忆",
    "加工速度",
    "心理测量",
    "测量学",
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
    # 第 3 轮实测：「这东西准吗」这类对测评本身可靠性的追问没有任何信号词，
    # 落到模糊区后被模型误判成 support（回了"听起来你最近状态不太好"）。
    # 它问的是产品/分数，不是自己的情绪 —— 这类必须由关键词接住。
    "准吗",
    "准不准",
    "准不准啊",
    "可信",
    "靠谱",
    "信度",
    "效度",
    "误差",
    "科学吗",
    "有意义吗",
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
    # 第 3 轮实测补充：这些是在说自己，不是在问分数，却被判成"指代不清"，
    # 回一句「你指的是哪一项？」——用户正在表达困扰时这样回答最伤体验。
    # 「焦虑症/抑郁症」由 BOUNDARY_WORDS 先命中（顺序在前），这里只收不带"症"的说法。
    "担心自己",
    "状态不好",
    "状态很差",
    "状态一直",
    "心情",
    "焦虑",
    "心态",
    "emo",
    # 被伤害类陈述：不是要讨论暴力内容，而是需要被接住（回复走支持口径）。
    "被打",
    "被人打",
    "家暴",
    "霸凌",
    "欺凌",
    "威胁我",
    # 人际伤害的困惑（"我被人起外号算暴力吗"）：这是求助，不是要讨论暴力内容。
    "算暴力",
    "算欺负",
    "算霸凌",
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
    # 第 4 轮评测补充：「这次怎么样」「总结一下」是最常见的总览问法，
    # 以前漏判会落到 explain，把四项指标原样重列一遍——答非所问。
    "这次怎么样",
    "这次如何",
    "这次咋样",
    "总结一下",
    "概括一下",
    "整体情况",
]
# 寒暄词。注意：它**不是**一条硬意图路由（见 classify 里的说明）。
GREETING_WORDS = ["你好", "您好", "hello", "hi", "嗨", "哈喽", "在吗", "在么", "早上好", "晚上好"]
# 能力询问：有明确答案（能做什么/是什么），不该回「你指的是哪一项？」。
CAPABILITY_WORDS = [
    "你是什么",
    "你能做什么",
    "你能做啥",
    "你能干嘛",
    "你是谁",
    "你会什么",
    "你有什么功能",
    "你怎么用",
    "怎么用你",
]
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

# --- 内容红线（课程要求：绝对限制）------------------------------------------------
# 分级原则：**强词直接拦**；**弱词必须同时命中"要内容/要评价"的语境**才拦，
# 否则会误杀「非暴力沟通」「政府奖学金」「学生会主席」「人生脚本」这类正常问题。
PORN_STRONG = [
    "色情",
    "涩情",
    "黄片",
    "黄色笑话",
    "黄色网站",
    "黄se",
    "黄图",
    "荤段子",
    "成人内容",
    "a片",
    "成人视频",
    "裸照",
    "裸聊",
    "约炮",
    "嫖娼",
    "情色",
    "r18",
    "18禁",
    "性暗示",
    "sex",
    "se情",
]
VIOLENCE_STRONG = [
    "砍人",
    "杀人",
    "弄死",
    "打死他",
    "枪击",
    "爆炸",
    "恐怖袭击",
    "虐杀",
    "自杀方法",
    "怎么死",
]
POLITICS_STRONG = ["政治", "台独", "藏独", "疆独", "六四", "颜色革命", "示威"]

# 弱词：只有用户明确要"看法/内容"时才按红线处理。
VIOLENCE_WEAK = ["暴力", "血腥", "虐待"]
POLITICS_WEAK = ["政府", "主席", "总统", "选举", "游行"]
CONTENT_REQUEST_CUES = [
    "怎么看",
    "如何看",
    "评价",
    "立场",
    "支持谁",
    "反对",
    "聊聊",
    "谈谈",
    "教我",
    "怎么做",
    "推荐",
    "想看",
    "给我讲",
    "为什么",
]
# 正常语境豁免：出现这些说法时不按红线处理（走 explain / unrelated / support）。
REDLINE_EXEMPT_RE = re.compile(
    r"非暴力|不暴力|暴力沟通|暴力美学"
    r"|人生脚本|剧本|脚本语言"
    r"|学生会主席|班长|社团"
    r"|奖学金|助学金|课程|必修|选修|考试"
)

# 与心智评估无关的工具类请求：一律不做。
# 只收"让我替你做"的说法，避免「如何提高编程能力」这种正常问题被误伤。
OFF_TASK_WORDS = [
    "写代码",
    "跑代码",
    "改代码",
    "调试代码",
    "写脚本",
    "运行脚本",
    "执行脚本",
    "改文件",
    "删除文件",
    "读取文件",
    "打开文件",
    "写个程序",
    "写个函数",
    "正则表达式",
    "帮我编程",
    "报错怎么修",
]
# 「帮我改一下这个文件」「跑一下代码看看」这类夹动词的说法，用正则兜住。
OFF_TASK_RE = re.compile(
    r"(?:改|删|读|打开|运行|执行|调试|修复).{0,4}(?:文件|代码|脚本|程序|报错)"
    r"|(?:写|跑|改|运行|执行).{0,6}(?:代码|脚本|程序)"
)
# 单独的「代码 / 脚本 / 文件」只有在带"替我操作"的动词时才判为工具请求。
OFF_TASK_BARE = ["代码", "脚本", "文件"]
OFF_TASK_ACTION_CUES = [
    "帮我",
    "给我",
    "替我",
    "写个",
    "写一个",
    "跑一下",
    "改一下",
    "运行",
    "执行",
    "调试",
    "修复",
    "删除",
]
# 趋势触发词：强词单独出现即可路由；弱词必须与维度名/分数语境同现，
# 避免「上次那个建议怎么还没做」这类跟进句被误读成趋势解释。
# 「比较」第 3 轮实测从强词降级：「我哪方面比较强」曾被它整句吃掉路由到趋势，
# 回一段两次分数差值 —— 答非所问。现在必须与"两次/上次/复测/变化"同现才算趋势。
TREND_STRONG_WORDS = [
    "趋势",
    "对比",
    "变化",
    "复测",
    "差多少",
    "有什么不一样",
    # 「我和上次比怎么样」只带弱词「上次」，以前要再命中「分数/这次」等语境词
    # 才进趋势，否则落到 explain 回一串本次指标。带「比」的说法直接算趋势。
    "和上次比",
    "比上次",
    "跟上次比",
]

# 强项/弱项询问（第 3 轮实测缺口）：「我有什么优点」「我擅长什么」「我哪方面比较强」
# 「我有什么不足」以前全部落到 clarify，要用户自己说出维度名 —— 这是最容易被
# 当成"agent 不聪明"的一类回答。它们其实有明确意图：本次哪几项相对高/低。
# 路由到 summary（它只描述"本次分数相对较高的维度"，不做能力评价，
# 评级措辞仍由 banned_word / mechanism_speculation 在输出侧拦）。
STRENGTH_WORDS = [
    "优点",
    "强项",
    "擅长",
    "哪方面强",
    "比较强",
    "更强",
    "最好",
    "最高",
    "不足",
    "短板",
    "弱项",
    "最差",
    "最低",
    "比较弱",
    "哪方面弱",
]
TREND_WEAK_WORDS = ["上次", "涨跌", "比较", "差别", "差距", "有没有提高", "有没有下降"]
TREND_CONTEXT_WORDS = [*DIMENSION_WORDS, "分数", "得分", "这次", "两次", "复测"]
# 自责重导向（ADR-0002 决策 6）：主语与贬义 6 字窗内共现才触发，
# 「这个方法没用」这类指向物的句子不触发。
SELF_BLAME_RE = re.compile(
    r"(?:我|自己)[^，,。;；！!？?\s]{0,6}(?:笨|蠢|废物|没用|脑子不行|脑子坏了)"
)

FIXED_REPLY = {
    INTENT["CLARIFY"]: (
        "你指的是哪一项？可以说维度名（比如「联想记忆」），"
        "也可以直接问「这次结果怎么读」或者「下一步怎么练」。"
    ),
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
    INTENT["BLOCKED"]: (
        "这个话题我不讨论：色情、暴力、政治类内容一律不处理，也不会生成相关内容。"
        "如果你愿意，我们可以回到本次测评——比如每个维度的原始指标怎么读。"
        "如果你或身边的人正处在危险里，请立刻联系 110、120 或身边可信任的人。"
    ),
    INTENT["OFF_TASK"]: (
        "我只做这次测评的解读，不帮你写代码、改文件、跑脚本，也不操作这台设备上的任何文件。"
        "想聊测评结果、某个维度怎么读、下一步怎么练，可以直接问。"
    ),
}

# 没有可解读结果时的寒暄口径（能力边界先说清，A1）。
GREETING_NO_FACTS = (
    "你好，我是 MindMeter 的解读助手。这里只解释你这次测评的原始指标，"
    "所以先完成一次测评，之后可以问「我的认知怎么样」，或问某个维度为什么低、下一步怎么练。"
)

NO_KNOWLEDGE_REPLY = (
    "站点内置的知识库里没有能直接回答这个问题的内容，我不猜。"
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

# 口语/近义说法 → 维度。用户很少说全称，「记性差」「反应慢」才是真实问法。
# 这张表同时用于：意图分类的维度识别、检索查询扩展。
COLLOQUIAL_DIM_WORDS = {
    # 联想记忆 am
    "记性": "am",
    "记不住": "am",
    "老是忘": "am",
    "背不下来": "am",
    "忘得快": "am",
    "记忆力": "am",
    # 知觉速度 ps
    "反应慢": "ps",
    "反应速度": "ps",
    "手慢": "ps",
    "做不快": "ps",
    "来不及": "ps",
    # 言语理解 vc
    "看不懂句子": "vc",
    "词不达意": "vc",
    "阅读慢": "vc",
    "词汇量": "vc",
    # 言语流畅 vf
    "说不出词": "vf",
    "想不起词": "vf",
    "卡壳": "vf",
    # 数字运算 nc
    "算数": "nc",
    "心算": "nc",
    "算得慢": "nc",
    "数学": "nc",
    # 归纳推理 ir
    "找规律": "ir",
    "规律题": "ir",
    "推理": "ir",
    # 空间视觉 sv
    "路痴": "sv",
    "方向感": "sv",
    "转不明白": "sv",
    "图形题": "sv",
    # 自然知识 ni
    "常识": "ni",
    "自然知识": "ni",
}
DIM_WORD_TO_ID.update(COLLOQUIAL_DIM_WORDS)
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
    "先做",
    "怎么安排",
    "安排",
]

# 「这项测什么」是在问**任务形式**，不是要练习建议。
# 以前它被塞进 ADVICE_ASK_WORDS，于是"知觉速度这项在测什么"回了
# 「下一步可以这样安排」——答非所问（第 4 轮评测发现）。
EXPLAIN_WHAT_WORDS = ["测什么", "测的是", "考什么", "考察什么", "测哪方面", "怎么测"]

# 各维度"测什么"的一句话；与前端 data.js 的 desc 同口径，供模板解释用。
DIM_MEASURES = {
    "vc": "词语关系与近义辨析",
    "vf": "限时说词，看提取速度",
    "nc": "心算与数量关系",
    "ir": "从例子里找规律",
    "ps": "限时辨认与反应速度",
    "sv": "图形旋转、拼接与定位",
    "am": "词对配对与再认",
    "ni": "常识与自然世界",
}

_PUNCT_RE = re.compile(r"[\s，,。.！!？?~～、;；:：\"'“”‘’()（）【】\[\]\-_*·|/\\+=<>#@&%$^`]+")

# 全角字母数字 → 半角（"ＳＥＸ" 这类绕过）
_FULLWIDTH = str.maketrans(
    "ＡＢＣＤＥＦＧＨＩＪＫＬＭＮＯＰＱＲＳＴＵＶＷＸＹＺａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ０１２３４５６７８９",
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
)


def normalize(text: str) -> str:
    """大小写归一 + 全角转半角 + 去空白/分隔符。

    「HI，我的认知怎么样」==「我的认知怎么样」；「色-情」「ＳＥＸ」这类
    插分隔符/全角的绕过也要归一到同一形状，否则红线词表形同虚设。
    """
    value = str(text or "").translate(_FULLWIDTH).lower()
    return _PUNCT_RE.sub("", value)


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


def is_explain_what_ask(question: str) -> bool:
    """问的是「这项测什么/怎么测」，不是「下一步怎么练」。"""
    lowered = normalize(question)
    if not lowered:
        return False
    return any(word in lowered for word in EXPLAIN_WHAT_WORDS)


MEDICATION_RE = re.compile(
    r"(?:吃|用|服|喝)(?:什么|哪种|这个|那个)?药"
    r"|药(?:怎么吃|吃多少|一次吃|几片|剂量|副作用|能不能吃|该不该吃)"
    r"|处方|药量"
)

# 「我的认知有问题吗」「我正常吗」是在要一个**判断**，而判断不是本产品能给的东西。
# 以前这类句子落到 summary/explain，回一串指标 —— 用户最担心的那句反而没被回应。
JUDGMENT_RE = re.compile(
    r"(有没有问题|有问题吗|算有问题|是不是问题"
    r"|正常吗|正常么|算正常|正不正常"
    r"|算差吗|算不算差|是不是差|很差吗|算好吗|算不算好)"
)


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
    # 口语说法（「反应慢」「记性差」）等同于点了维度名，算作领域信号。
    domain = [*hits(text, DOMAIN_WORDS), *dims_in_question(text)]
    unrelated = hits(text, UNRELATED_WORDS)

    matched = hits(text, CRISIS_WORDS)
    if matched:
        return {"intent": INTENT["CRISIS"], "matched": matched, "reason": "crisis-word"}
    # 内容红线：分级判定。强词直接拦；弱词要同时有"要内容/要评价"的语境才拦；
    # 命中豁免说法（非暴力沟通、政府奖学金、学生会主席、人生脚本…）一律放行。
    exempt = bool(REDLINE_EXEMPT_RE.search(text))
    hard = [*hits(text, PORN_STRONG), *hits(text, VIOLENCE_STRONG), *hits(text, POLITICS_STRONG)]
    soft = [*hits(text, VIOLENCE_WEAK), *hits(text, POLITICS_WEAK)]
    cues = [cue for cue in CONTENT_REQUEST_CUES if cue in text]
    if not exempt and (hard or (soft and cues)):
        return {
            "intent": INTENT["BLOCKED"],
            "matched": [*hard, *soft],
            "reason": "content-redline",
        }
    matched = hits(text, BOUNDARY_WORDS)
    if matched:
        return {"intent": INTENT["BOUNDARY"], "matched": matched, "reason": "medical-word"}
    # 第 4 轮评测：「这个药怎么吃」没命中「吃药/药物/用药」，落到 explain 回了指标。
    # 用药类说法一律按医疗边界处理，宁可多拦不可放过。
    if MEDICATION_RE.search(text):
        return {
            "intent": INTENT["BOUNDARY"],
            "matched": [MEDICATION_RE.search(text).group(0)],
            "reason": "medication-advice",
        }
    matched = hits(text, HIGH_DOMAIN_WORDS)
    if matched:
        return {"intent": INTENT["HIGH_DOMAIN"], "matched": matched, "reason": "high-domain-word"}
    blame = SELF_BLAME_RE.search(text)
    if blame:
        return {"intent": INTENT["SELF_BLAME"], "matched": [blame.group(0)], "reason": "self-blame"}
    # 「有没有问题/正常吗」→ 不做判断，用同一套"这不是测评能得出的结论"口径回应。
    judgment = JUDGMENT_RE.search(text)
    if judgment:
        return {
            "intent": INTENT["SELF_BLAME"],
            "matched": [judgment.group(0)],
            "reason": "judgment-question",
        }
    matched = hits(text, SUPPORT_WORDS)
    if matched:
        return {"intent": INTENT["SUPPORT"], "matched": matched, "reason": "support-word"}
    if any(phrase in text for phrase in ADVICE_PHRASES):
        return {"intent": INTENT["SUMMARY"], "matched": [], "reason": "advice-question"}
    # 工具类请求（写代码/改文件/跑脚本）不属于心智评估，先于"离题"判断。
    off_task = hits(text, OFF_TASK_WORDS)
    tool_match = OFF_TASK_RE.search(text)
    bare = (
        (not exempt)
        and any(word in text for word in OFF_TASK_BARE)
        and any(cue in text for cue in OFF_TASK_ACTION_CUES)
    )
    if off_task or bare or tool_match:
        matched = off_task or ([tool_match.group(0)] if tool_match else [])
        if not matched:
            matched = [word for word in OFF_TASK_BARE if word in text]
        return {
            "intent": INTENT["OFF_TASK"],
            "matched": matched,
            "reason": "tool-request",
        }
    if unrelated and not domain:
        return {"intent": INTENT["UNRELATED"], "matched": unrelated, "reason": "off-topic"}
    trend = hits(text, TREND_STRONG_WORDS)
    if trend or (hits(text, TREND_WEAK_WORDS) and hits(text, TREND_CONTEXT_WORDS)):
        return {
            "intent": INTENT["TREND"],
            "matched": [*trend, *hits(text, TREND_WEAK_WORDS)],
            "reason": "trend-word",
        }
    # 强项/弱项 → summary（放在趋势之后：「这两次哪项比较强」有趋势语境，仍走趋势）。
    strength = hits(text, STRENGTH_WORDS)
    if strength:
        return {
            "intent": INTENT["SUMMARY"],
            "matched": strength,
            "reason": "strength-question",
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

    # 能力询问（「你能做什么」「你是什么模型」）用能力说明回答，而不是澄清。
    capability = hits(text, CAPABILITY_WORDS)
    if capability:
        return {
            "intent": INTENT["GREETING"],
            "matched": capability,
            "reason": "capability-question",
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


# ---------------------------------------------------------------------------
# 关键词规则 + LLM 兜底的合并策略（纯函数，可离线单测）
# ---------------------------------------------------------------------------

# 关键词命中这些意图时**不需要**再问模型：要么安全红线已触发（必须关键词优先，
# 绝不能交给模型裁决），要么信号明确（领域词/趋势语境/建议诉求）。
CONFIDENT_INTENTS = frozenset(
    {
        INTENT["CRISIS"],
        INTENT["BLOCKED"],
        INTENT["OFF_TASK"],
        INTENT["BOUNDARY"],
        INTENT["HIGH_DOMAIN"],
        INTENT["SUPPORT"],
        INTENT["SELF_BLAME"],
        INTENT["EXPLAIN"],
        INTENT["TREND"],
        INTENT["TREND_NO_DATA"],
        INTENT["SUMMARY"],
    }
)

# 只有这些"拿不准"的结果才值得花一次模型调用去救 —— 它们正是用户体感
# "答非所问 / 要我自己说出维度名"的来源。
AMBIGUOUS_INTENTS = frozenset({INTENT["CLARIFY"], INTENT["UNRELATED"], INTENT["GREETING"]})

# 模型可以改判到的业务意图（闭集，别的值一律不接受）。
LLM_ALLOWED_INTENTS = frozenset(
    {
        INTENT["EXPLAIN"],
        INTENT["SUMMARY"],
        INTENT["TREND"],
        INTENT["CLARIFY"],
        INTENT["UNRELATED"],
        INTENT["BOUNDARY"],
        INTENT["SUPPORT"],
        INTENT["SELF_BLAME"],
    }
)


def needs_llm_fallback(result: dict) -> bool:
    """关键词结果是否模糊到需要模型兜底。"""
    return str((result or {}).get("intent")) in AMBIGUOUS_INTENTS


def resolve_intent(
    keyword_result: dict,
    llm_intent: str | None,
    *,
    has_facts: bool = False,
    has_trend: bool = False,
) -> tuple[str, str]:
    """合并关键词与模型判定，返回 (intent, intent_source)。

    四条不变式（顺序即优先级）：

    1. **安全红线不可降级**：危机/越界/高风险领域/疏导/自责由关键词决定，
       模型无权改判 —— 宁可多拒答，也不能因为模型误判把求助句路由成普通解释。
    2. **模型只兜模糊**：关键词已经命中领域词/趋势语境/建议诉求时不采纳模型，
       否则等于把已经正确的答案交给一次额外调用去赌。
    3. **闭集 + 失败即回退**：模型返回不在白名单里、或调用失败/超时，
       一律沿用关键词结果，行为与没有这个功能时完全一致。
    4. **改判必须与可支撑的数据相容**（第 3 轮实测加入）：只有一条测评记录时
       不许路由到 trend，没有任何测评结果时不许路由到 explain/summary。
       当时「那个呢」被模型猜成 trend，用户收到"这个账号还没有两次可比的测评"
       —— 比原来的追问更误导。模型可以猜语义，但不能猜我们有没有那份数据。
    """
    keyword_intent = str((keyword_result or {}).get("intent") or INTENT["CLARIFY"])
    if keyword_intent in CONFIDENT_INTENTS:
        return keyword_intent, "rule"
    if not llm_intent or llm_intent not in LLM_ALLOWED_INTENTS:
        return keyword_intent, "rule"
    if llm_intent == INTENT["TREND"] and not has_trend:
        return keyword_intent, "rule"
    if llm_intent in (INTENT["EXPLAIN"], INTENT["SUMMARY"]) and not has_facts:
        return keyword_intent, "rule"
    if llm_intent == keyword_intent:
        return keyword_intent, "rule"
    return llm_intent, "llm"


def fixed_reply(intent: str) -> str:
    return FIXED_REPLY.get(intent, FIXED_REPLY[INTENT["UNRELATED"]])
