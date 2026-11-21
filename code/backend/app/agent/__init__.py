"""LangGraph agent for the local assistant.

The graph is deliberately small: classify -> retrieve -> generate -> validate.
Crisis/boundary/self-blame/unrelated/clarify never call a model. Any model
failure falls back to a per-scene deterministic template. All generation and
validation rules for a scene live in `policies.SCENE_POLICIES` so the chat
page, the trend explanation and the report card share ONE guarded output path
(docs/software/agent-trend-workflow.md, docs/adr/0002).
"""
from __future__ import annotations

import math
import re
import time
from contextvars import ContextVar
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, TypedDict

from langgraph.graph import END, StateGraph
from sqlalchemy.orm import Session

from ..analysis import DIM_NAMES, DIM_ORDER, SPECIFIC_SUGGESTIONS
from ..analysis import build_messages as build_analysis_messages
from ..analysis import retrieve_context, template_analysis, weak_dims
from ..config import settings
from ..llm import LLMError, call_llm_with_fallback, site_llm_config
from ..rag import retrieve as retrieve_kb
from ..templates import metric_clauses, reading_sentence, template_narrative, template_trend
from .classify import (  # 分类与会场话术只在 classify.py 定义一次，这里转出用到的名字
    DIMENSION_WORDS,
    DIM_MEASURES,
    DOMAIN_WORDS,
    FIXED_REPLY,
    GREETING_NO_FACTS,
    INTENT,
    NO_KNOWLEDGE_REPLY,
    RISK_BY_INTENT,
    SCOPE_BACKFILL,
    classify,
    dims_in_question,
    fixed_reply,
    is_advice_ask,
    is_explain_what_ask,
    needs_llm_fallback,
    resolve_intent,
)
from .intent_llm import classify_with_llm
from .misconceptions import build_correction, should_correct
from .structured import STRUCTURED_INSTRUCTION, parse_structured
from .policies import (
    CITATION_PLACEHOLDERS,
    DEFAULT_MAX_CHARS,
    MECHANISM_BELONGS_RE,
    MECHANISM_NOUNS,
    MECHANISM_VERBS,
    SCOPE_MARKERS,
    DEFAULT_SCENE,
    policy_for,
    prompt_for,
)

BANNED_WORDS = [
    "诊断",
    "确诊",
    "治疗",
    "症状",
    "疾病",
    "障碍",
    "药物",
    "用药",
    "服用",
    "就医",
    "抑郁",
    "焦虑症",
    "正常",
    "异常",
    "缺陷",
    "康复",
    "提升智商",
    "提高智力",
    "脑龄",
    "延缓衰老",
    "减退",
    "受损",
    "退化",
]

# ---------------------------------------------------------------------------
# 能力评级红线（ADR-0002 决策 4：禁止一切特质归因，正负皆禁）
#
# 实测（glm-4-flash-250414）：问「为什么联想记忆低」，模型写着「…这表明在回忆速度
# 和准确性上表现中等」就过关了 —— 上面的词表只收临床词，评级词一个都没收，
# 「不推断能力高低」这条产品红线在校验器上是空转的。
#
# 但裸收「中等 / 较好 / 良好」会误伤正常表述（「这次作答速度较快」是任务条件描述，
# 不是评级；「不能说明你能力较弱」恰恰是我们要的免责句）。所以三层判定：
#   ① 多字固定搭配（表现中等、智力水平、能力较强…）：几乎只会出现在评级句里 → 直接拦；
#   ② 短评级词（中等/较好/良好…）：只有挨着评价对象（表现/水平/能力/成绩…）才算评级
#      → 上下文规则；「速度较快」「回答较短」不带评价对象，放行；
#   ③ 命中处同一句里在前有明确否定词（不能/不是/谈不上…）→ 视为免责句，放行。
# ---------------------------------------------------------------------------
ABILITY_RATING_WORDS = [
    "表现中等",
    "表现良好",
    "表现优秀",
    "表现出色",
    "表现突出",
    "表现一般",
    "表现平平",
    "表现较弱",
    "表现较强",
    "表现较好",
    "表现较差",
    "表现不佳",
    "表现欠佳",
    "中等水平",
    "中上水平",
    "中下水平",
    "水平中等",
    "水平一般",
    "水平平平",
    "水平较高",
    "水平较低",
    "水平较好",
    "水平较差",
    "水平优秀",
    "水平良好",
    "智力水平",
    "智商水平",
    "认知水平",
    "能力水平",
    "能力较强",
    "能力较弱",
    "能力较好",
    "能力较差",
    "能力偏高",
    "能力偏低",
    "能力出众",
    "能力超常",
    "能力优秀",
    "记忆力较强",
    "记忆力较好",
    "记忆力较弱",
    "记忆力差",
    "很有天赋",
    "有天赋",
    "天赋异禀",
    "中等偏上",
    "中等偏下",
    "处于中等",
    "属于中等",
    "略低于平均",
    "高于平均",
    "低于平均",
    "平均水平",
]
# 评级词单独出现不判死，只有挨着"能力归属名词"（表现/水平/能力/成绩…）才算评级。
# 有意不含「记忆/推理/速度/准确率」这类指标名：模型写"命中率较高"是在描述数字，
# 不是给人定级，拦它就是把有用回答打回模板（用户实测的另一半抱怨来源）。
RATING_TARGETS = [
    "表现",
    "水平",
    "能力",
    "智力",
    "智商",
    "认知",
    "成绩",
    "结果",
    "发挥",
]
RATING_QUALIFIERS = [
    "中等",
    "中上",
    "中下",
    "偏上",
    "偏下",
    "较高",
    "较低",
    "较好",
    "较差",
    "较强",
    "较弱",
    "一般",
    "平平",
    "不佳",
    "欠佳",
    "良好",
    "优秀",
    "出色",
    "出众",
    "突出",
    "超常",
]
RATING_CONTEXT_RE = re.compile(
    r"(?:"
    + "|".join(RATING_TARGETS)
    + r")(?:上|方面|层面|来看)?[^，。；\n]{0,3}(?:"
    + "|".join(RATING_QUALIFIERS)
    + r")|(?:"
    + "|".join(RATING_QUALIFIERS)
    + r")(?:的)?(?:"
    + "|".join(RATING_TARGETS)
    + r")"
)
# 免责句里出现评级词是符合口径的（「不能说明你能力较弱」「不与人群平均水平比较」），不该拦。
NEGATION_MARKERS = [
    "不能",
    "不会",
    "不是",
    "并非",
    "并不",
    "无法",
    "不等于",
    "谈不上",
    "不足以",
    "没有",
    "不要",
    "不该",
    "不应",
    "不算",
    "不与",
    "不跟",
    "不作",
    "不做",
    "避免",
]


# 命中词之前的小窗口里出现否定线索 → 视为免责用法。
# 逐个补否定词是打补丁（第 3 轮实测：「不代表任何疾病」「不用于诊断」都不在表里），
# 所以这里按"否定字头"判定：不/未/无/非/别/莫/免/防止/避免/禁止/难以/谈不上。
_NEGATION_CUE_RE = re.compile(r"[未曾无非别莫]|不能|不会|不要|不该|不应|不算|不作|不做|不与|不跟|不用于|不代表|不是|并非|并不|不等于|不足以|谈不上|没有|避免|禁止|难以")
NEGATION_WINDOW = 10


def _negated_before(sentence: str, hit: str) -> bool:
    index = sentence.find(hit)
    if index < 0:
        return False
    before = sentence[max(0, index - NEGATION_WINDOW) : index]
    return bool(_NEGATION_CUE_RE.search(before)) or any(
        marker in before for marker in NEGATION_MARKERS
    )


def banned_word_hits(text: str, rule: dict | None = None) -> list[str]:
    """禁用词命中，但**免责用法不算**（第 3 轮实测的误伤）。

    真实案例：问「这两次有什么变化」，模型写「这不是诊断结论」——裸词表把"诊断"
    判成 hard，正确的趋势回答整条退回模板。而系统自己补写的固定声明
    （`SCOPE_BACKFILL`：「…也不能读成能力高低或诊断」）含同一个词却合法，
    等于"只许官方免责，不许模型免责"，自相矛盾。

    规则与评级词一致：**同一句里命中词之前出现否定标记 → 视为免责**，放行；
    没有任何否定语境的「可以诊断出…」仍然 hard。
    """
    value = str(text or "")
    words = [*BANNED_WORDS, *((rule or {}).get("extra_banned") or [])]
    findings: list[str] = []
    for word in words:
        if word not in value:
            continue
        offenders = [
            sentence
            for sentence in _sentences(value)
            if word in sentence and not _negated_before(sentence, word)
        ]
        if offenders:
            findings.append(word)
    return findings


RATING_NEUTRAL_POSITIVE = "本次分数相对较高"
RATING_NEUTRAL_NEGATIVE = "本次分数相对较低"
_RATING_NEGATIVE_HINTS = ("较差", "较弱", "最差", "较低", "偏低", "不足", "薄弱", "弱")


def repair_rating_wording(text: str) -> str:
    """把能力评级措辞改写成中性表述，保留其余内容。

    第 3 轮实测：问「我哪方面比较强」时模型 4/4 次都写「表现较好」——它在镜像
    用户的措辞，提示词教不动。以前的处理是整条判死退回模板，于是这个问题**永远**
    看不到模型答案。但项目红线是"Agent 只能错措辞，不能错分数/结论"：
    缺陷只在措辞时，正确动作是把措辞改对，而不是把整份内容扔掉。

    边界：只改写评级词本身，不动任何数字与句子结构；改写后仍要重新过整套校验，
    还有 hard 问题照样退回模板。临床/危机词（诊断、治疗、抑郁…）**不做改写**——
    那不是措辞问题，是真越界。
    """
    value = str(text or "")
    hits = [hit for hit in ability_rating_hits(value) if hit]
    if not hits:
        return value
    for hit in sorted(hits, key=len, reverse=True):
        replacement = RATING_NEUTRAL_NEGATIVE if any(k in hit for k in _RATING_NEGATIVE_HINTS) else RATING_NEUTRAL_POSITIVE
        value = value.replace(hit, replacement)
    return value


def ability_rating_hits(text: str) -> list[str]:
    """命中即视为能力评级（hard）。返回命中片段，detail 里能说清拦在哪一句。"""
    value = str(text or "")
    findings = [word for word in ABILITY_RATING_WORDS if word in value]
    findings.extend(match.group(0) for match in RATING_CONTEXT_RE.finditer(value))
    sentences = _sentences(value)
    unique: list[str] = []
    for hit in dict.fromkeys(findings):
        hosts = [sentence for sentence in sentences if hit in sentence]
        if hosts and all(_negated_before(sentence, hit) for sentence in hosts):
            continue  # 每句里都是否定语境 → 免责表述，放行
        unique.append(hit)
    return unique

CITATION_RE = re.compile(r"引用\s*[:\uFF1A]|[Kk][Bb]-[A-Za-z0-9-]+|\bfacts\b")
CITATION_LINE_RE = re.compile(r"(?:引用|参考)\s*[:\uFF1A][^\n]*")
KB_ID_RE = re.compile(r"[Kk][Bb]-[A-Za-z0-9\-_]+")
NUMBER_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(分|次|题|个|秒|毫秒|ms|%|岁|项|°|度)?")
# 版本号形态的点分数字（scoring-v3.2、bge-small-zh-v1.5）不是"用户读到的指标数字"：
# 它紧跟在字母/连字符后面。模型复述计分口径版本时不该被 unsourced_number 判死，
# 而 "2.5 秒" 这类前面是空格或汉字的点分小数仍然照常校验。
VERSION_NUMBER_RE = re.compile(r"(?<=[A-Za-z_\-])\d+(?:\.\d+)+")
TRAILING_CITATION_RE = re.compile(r"\n*引用\s*[:\uFF1A][^\n]*\s*$")

# 绝对化表述：模型会把「错了几题」写成「全部错误」「完全不会」。
# 这是措辞失真（比幻觉轻，但同样误导），由 _validate_node 对照 facts 拦截。
ABSOLUTE_CLAIM_RE = re.compile(
    r"(?:全部|全都|完全|一律|全都)(?:错误|做错|答错|没对|不对|不会)"
    r"|一个都没对|一道都没对|全错"
)


def has_positive_correct(facts: dict | None) -> bool:
    """facts 里是否存在"答对/命中"这类正计数；用于判断绝对化表述是否失真。"""
    if not isinstance(facts, dict):
        return False
    for metrics in facts.values():
        if not isinstance(metrics, dict):
            continue
        for key in ("correct", "encCorrect", "catCorrect", "hits"):
            value = metrics.get(key)
            if isinstance(value, (int, float)) and value > 0:
                return True
    return False
# 全角数字/小数点/百分号与半角同值：不归一就会切错 token（"１．８７" 里根本没有
# 半角数字，于是整个数字对校验器隐形 —— 那是放行幻觉数字的口子，不是宽松度）。
FULLWIDTH_DIGITS = {ord(c): str(index) for index, c in enumerate("０１２３４５６７８９")}
FULLWIDTH_DIGITS[ord("．")] = "."
FULLWIDTH_DIGITS[ord("％")] = "%"
# 千分位："1,870 毫秒" 是一个数字 1870，不是"1"和"870"两个没出处的数字。
THOUSANDS_RE = re.compile(r"(?<=\d),(?=\d{3}(?!\d))")
# ---------------------------------------------------------------------------
# 中文数字的度量表述
#
# `extract_numbers` 只认阿拉伯数字，所以模型改用中文写法就等于绕开整条
# unsourced_number 校验。实测（真实模型 · 「我接下来该练什么」）把
# meanRtMs 2500 写成「平均用时两分五十秒」= 170 秒：既看不见、又是**错数字**
# （项目红线"不能错分数"）。
#
# 处理方式不是"见到中文数字就拦"（那样「四十五秒」这种照抄 facts 的说法也会
# 回退模板，用户又看不到模型回答了），而是**把它翻译成数值再走同一张白名单**：
#   四十五秒 → 45（facts 里有）→ 放行
#   一点八七秒 → 1.87（白名单里的换算值）→ 放行
#   两分五十秒 → 2*60+50 = 170（哪儿都没有）→ hard
#   百分之六十二点五 → 62.5（派生百分比）→ 放行
# 仍然是精确命中，没有任何容差。
# ---------------------------------------------------------------------------
CN_DIGIT_VALUES = {
    "〇": 0,
    "零": 0,
    "一": 1,
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
}
CN_UNIT_VALUES = {"十": 10, "百": 100, "千": 1000}
CN_NUMBER_CHARS = "".join(CN_DIGIT_VALUES) + "".join(CN_UNIT_VALUES) + "点"
CN_NUMBER_BLOCK = "[" + CN_NUMBER_CHARS + "]{1,8}"
# 「两分五十秒」= 170 秒：唯一带"分"的复合读法（「一分钟」「五分钟」不命中，因为没有秒）。
CN_MMSS_RE = re.compile(r"(?<![第每上下这那前后])(" + CN_NUMBER_BLOCK + r")分(" + CN_NUMBER_BLOCK + r")秒")
# 「1.87 秒」写成「一点八七秒」、45 秒写成「四十五秒」、1870 毫秒写成「一千八百七十毫秒」。
CN_SECONDS_RE = re.compile(
    r"(?<![第每上下这那前后])(" + CN_NUMBER_BLOCK + r")\s*(毫秒|秒)(?!钟)"
)
CN_PERCENT_RE = re.compile(r"百分之\s*(" + CN_NUMBER_BLOCK + r")")


def cn_number_to_float(text: str) -> float | None:
    """「四十五」→ 45，「一点八七」→ 1.87，「一千八百七十」→ 1870；读不出给 None。"""
    raw = str(text or "").strip()
    if not raw:
        return None
    if "点" in raw:
        head, _, tail = raw.partition("点")
        whole = cn_number_to_float(head) if head else 0.0
        if whole is None or not tail:
            return None
        digits = ""
        for char in tail:
            if char not in CN_DIGIT_VALUES:
                return None
            digits += str(CN_DIGIT_VALUES[char])
        return float(f"{int(whole)}.{digits}")
    total = 0.0
    current = 0.0
    seen_unit = False
    for char in raw:
        if char in CN_DIGIT_VALUES:
            current = float(CN_DIGIT_VALUES[char])
        elif char in CN_UNIT_VALUES:
            total += (current if (current or seen_unit) else 1.0) * float(CN_UNIT_VALUES[char])
            current = 0.0
            seen_unit = True
        else:
            return None
    return total + current if (seen_unit or current) else None


def chinese_measure_hits(text: str, allowed: set[float]) -> list[str]:
    """中文数字写的时间/百分比：先换算成数值，再和白名单**精确**比对。

    只处理单位明确的读法（秒、毫秒、百分之…），因为这几类才是"本次指标数字"；
    「五题中的六题」这种题量口语不拦（白名单本来就是全维度并集，拦了只会误伤）。
    """
    value = str(text or "")
    findings: list[str] = []
    mmss_spans: list[tuple[int, int]] = []
    for match in CN_MMSS_RE.finditer(value):
        minutes = cn_number_to_float(match.group(1))
        seconds = cn_number_to_float(match.group(2))
        if minutes is None or seconds is None:
            continue
        mmss_spans.append(match.span())
        total = minutes * 60.0 + seconds
        if total not in allowed:
            findings.append(f"{match.group(0)}（={total:g} 秒）")
    for match in CN_SECONDS_RE.finditer(value):
        # 「两分五十秒」里的「五十秒」是同一次读数，不能重复算两遍。
        if any(start <= match.start() < end for start, end in mmss_spans):
            continue
        number = cn_number_to_float(match.group(1))
        if number is None:
            continue
        if match.group(2) == "毫秒":
            ok = number in allowed or _half_up(number / 1000.0, 2) in allowed
        else:
            ok = number in allowed or (number * 1000.0) in allowed
        if not ok:
            findings.append(match.group(0).strip())
    for match in CN_PERCENT_RE.finditer(value):
        number = cn_number_to_float(match.group(1))
        if number is not None and number not in allowed:
            findings.append(match.group(0).strip())
    return list(dict.fromkeys(findings))


# 毫秒语义字段的命名形态（见 `_is_ms_metric_key` 的读码出处）。
_MS_KEY_SUFFIXES = ("Ms", "_ms", "_MS", "Rts", "RTs", "_rts")
_MS_KEY_EXACT = {"rt", "rts"}

_DB: ContextVar[Session | None] = ContextVar("mm_agent_db", default=None)


class AgentState(TypedDict, total=False):
    question: str
    facts: dict
    history: list
    memory: dict
    scene: str
    intent: str
    matched: list
    # 意图来自关键词还是 LLM 兜底（rule | llm | scene）：调路由时最需要这条数据。
    intentSource: str
    chunks: list
    citations: list
    sources: list
    text: str
    source: str
    code: str
    risk: str
    model: str
    latency_ms: int
    validation: list
    valid: bool
    issues: list


def collect_numbers(value: Any) -> list[float]:
    out: list[float] = []

    def walk(item: Any) -> None:
        if isinstance(item, (int, float)) and not isinstance(item, bool):
            out.append(float(item))
        elif isinstance(item, list):
            for child in item:
                walk(child)
        elif isinstance(item, dict):
            for child in item.values():
                walk(child)

    walk(value)
    return out


def _half_up(value: float, digits: int) -> float:
    """十进制四舍五入（不是 Python 的 `round` 银行家舍入）。

    2500/1000 = 2.5 在二进制里精确，`round(2.5)` 给 2；5/8 = 62.5% 一 round
    给 62，而人和模型都写 63。白名单必须按"人怎么四舍五入"生成，否则换算
    本身合法、数字却对不上，又是一次误杀。仍然是**离散值**，不是容差匹配。
    """
    quantum = Decimal(1).scaleb(-digits)
    return float(Decimal(repr(float(value))).quantize(quantum, rounding=ROUND_HALF_UP))


def _is_ms_metric_key(key: object) -> bool:
    """字段名是否表示毫秒（决定哪些值允许做 ms→s 换算）。

    读码确认的真实字段（`code/frontend/src/tasks/*.js` + `app/scoring`）：
    vc/ps 上报 `meanRtMs`（平均毫秒，`Math.round` 后的整数），sv 上报
    `correctRts`（逐题毫秒数组：`score_sv` / `sv_median_rt` 按毫秒中位数用它），
    逐题草稿里是 `rtMs`。判定只认两类形态：
      * 毫秒单位后缀：以 `Ms` / `_ms` / `_MS` 结尾；
      * 反应时数组：以 `Rts` / `_rts` 结尾，或裸写 `rt` / `rts`。
    `seconds` / `studySeconds`（本来就是秒）、`score` / `total`（无量纲）都不
    在这里 —— 不会被凭空"除以 1000"。
    """
    name = str(key or "")
    if not name:
        return False
    if name.endswith(_MS_KEY_SUFFIXES):
        return True
    return name.lower() in _MS_KEY_EXACT


def _ms_metric_values(metrics: dict) -> list[float]:
    """一个维度里所有毫秒语义的读数（数组字段逐个展开）。"""
    out: list[float] = []
    for key, value in metrics.items():
        if not _is_ms_metric_key(key):
            continue
        items = value if isinstance(value, list) else [value]
        for item in items:
            if isinstance(item, bool) or not isinstance(item, (int, float)):
                continue
            if math.isfinite(float(item)):
                out.append(float(item))
    return out


def _derived_from_metrics(metrics: dict) -> set[float]:
    """Deterministic one-step derivations of the numbers inside ONE dimension.

    Sums/abs-differences between the dimension's metric values; percentages of
    one count-like value over another value or over a pairwise sum (so "正确率 =
    hits/(hits+falseAlarms)" passes at both 62.5% and 63%); and ms → seconds for
    every millisecond-semantics field (`meanRtMs`, `correctRts`, …) kept at 1
    and 2 decimals. Nothing chained beyond that, and no fuzzy matching: every
    entry is an exact, reproducible transform of a facts value.
    """
    values = [v for v in metrics.values() if isinstance(v, (int, float)) and not isinstance(v, bool)]
    out: set[float] = set()
    for a in values:
        for b in values:
            out.add(float(a + b))
            out.add(float(abs(a - b)))
    # 百分比只认真实口径的"部分 ÷ 整体"：
    #   * `score` 不参与 —— 它本身已经是服务端折算出来的百分制结果，让
    #     `score/(score+correct)` 这类比值进白名单，会凭空造出 91、88 这种
    #     facts 里根本没有的"正确率"（红线：派生不出来的数字必须拦）；
    #   * 毫秒字段不参与 —— 反应时之间没有百分比语义，1880/(1880+12) = 99.4
    #     同样只是噪音；
    #   * 分子不超过分母 —— "正确率 160%" 不是合法派生。
    ratio_values = [
        float(v)
        for key, v in metrics.items()
        if key != "score" and not isinstance(v, bool) and isinstance(v, (int, float))
        and not _is_ms_metric_key(key)
    ]
    denominators = set(ratio_values) | {a + b for a in ratio_values for b in ratio_values}
    for a in ratio_values:
        for denom in denominators:
            if not denom or a > denom:
                continue
            pct = a / denom * 100.0
            out.add(float(round(pct)))
            out.add(float(math.floor(pct)))
            out.add(float(math.ceil(pct)))
            # 一位小数：用户实测被误杀的 62.5%（5/8）就差这一档。
            out.add(_half_up(pct, 1))
    # 毫秒 → 秒：对**每个**毫秒语义读数（含 correctRts 数组里的每一题）给
    # 1 位与 2 位小数两个形态：1870 → 1.9 / 1.87，2500 → 2.5 / 2.5。
    # 提示词同口径要求"换算只保留 1–2 位小数"，三位小数（1.873）仍然算没出处。
    # 整数秒是旧版就有的派生（round(rt/1000)），保留以免把"约 2 秒"打回模板。
    for ms in _ms_metric_values(metrics):
        seconds = ms / 1000.0
        out.add(_half_up(seconds, 1))
        out.add(_half_up(seconds, 2))
        out.add(float(round(seconds)))
        out.add(_half_up(seconds, 0))
    return out


def derived_allowed_numbers(facts: dict | None) -> set[float]:
    allowed = set(collect_numbers(facts or {}))
    for key, metrics in (facts or {}).items():
        if key == "trend" or not isinstance(metrics, dict):
            continue
        allowed |= _derived_from_metrics(metrics)
    return allowed


def _strip_citations(text: str) -> str:
    text = re.sub(r"引用\s*[:\uFF1A][^\n]*", "", text)
    text = re.sub(r"[Kk][Bb]-[A-Za-z0-9-]+", "", text)
    # 版本号（scoring-v3.2 之类）不参与数字校验：它是口径标识，不是本次指标。
    return VERSION_NUMBER_RE.sub("", text)


def _normalize_number_text(text: str) -> str:
    """把"同一个数值的不同写法"归一到同一种形态，然后再切数字。

    只做形态归一，**不做容差匹配**：归一之后仍然要在白名单里精确命中。
      * 全角数字/小数点/百分号（１．８７％ → 1.87%）：不归一时这些数字对
        校验器完全隐形，等于给幻觉数字开后门；
      * 千分位逗号（1,870 → 1870）：不然 "1,870 毫秒" 会被切成 1 和 870
        两个"没出处"的数字，把合法回答打死。
    单位后缀不参与比较（`validate_text` 只按 value 命中白名单），所以
    "1.87 秒 / 1.87秒 / 1.87s / 1870 毫秒" 都是同一个数值。
    """
    body = str(text or "").translate(FULLWIDTH_DIGITS)
    return THOUSANDS_RE.sub("", body)


def extract_numbers(text: str) -> list[dict]:
    body = _normalize_number_text(_strip_citations(str(text or "")))
    body = re.sub(r"(?m)^\s*\d+\s*[.、)）]\s*", " ", body)
    body = re.sub(r"(?<!\d)\d{1,2}\s*[）)]", " ", body)
    return [
        {"value": float(match.group(1)), "raw": match.group(0).strip(), "unit": match.group(2) or ""}
        for match in NUMBER_RE.finditer(body)
    ]


def _dim_alias_map() -> dict[str, str]:
    """维度字面 → 维度 id。

    2026-11-20 用户实测第 3 轮暴露的 bug：校验词表用的是简称（`空间视觉`、`言语流畅`），
    归属表用的是全称（`空间视觉化`），两边按字符串比对 → 模型写「空间视觉化 0 → 100」
    被判成"100 属于空间视觉化，却写在了空间视觉里"，把**正确回答**拦回模板。
    现在统一按维度 id 比对，字面只作匹配入口。
    """
    aliases: dict[str, str] = {}
    for dim in DIM_ORDER:
        full = DIM_NAMES.get(dim, dim)
        aliases[full] = dim
    for word in DIMENSION_WORDS:
        for dim in DIM_ORDER:
            full = DIM_NAMES.get(dim, dim)
            if word and (full == word or full.startswith(word)):
                aliases.setdefault(word, dim)
    return aliases


DIM_ALIAS = _dim_alias_map()


def _named_dims(sentence: str) -> set[str]:
    found: set[str] = set()
    for surface, dim in DIM_ALIAS.items():
        if surface in sentence:
            found.add(dim)
    return found


def dimension_score_owners(facts: dict | None) -> dict[float, set[str]]:
    """每个参考分属于哪些维度 id —— 用来抓"张冠李戴"。

    实测（接通真实模型后）：问"为什么联想记忆低"，模型会写成
    「联想记忆…正确回忆出5组，得分为50分」，而 5/50 是言语理解的数字。
    本项目红线是"Agent 只能错措辞，不能错分数/结论"，所以规则刻意做窄：
    **句子点名了某维度，就不许出现只属于别的维度的参考分**；题量类数字不参与。

    趋势语境必须把 `prev / next / delta` 都登记进来（第 3 轮实测第二个误伤源）：
    「归纳推理 25 → 50」里的 25 是 ir 的上次分数，只登记本次分数就会把它
    认成别的维度的数字，把正确回答拦掉。
    """
    owners: dict[float, set[str]] = {}

    for dim, metrics in (facts or {}).items():
        if dim == "trend" or not isinstance(metrics, dict):
            continue
        score = metrics.get("score")
        if isinstance(score, int):
            owners.setdefault(float(score), set()).add(dim)

    trend = (facts or {}).get("trend")
    if isinstance(trend, dict):
        for row in trend.get("rows") or []:
            if not isinstance(row, dict):
                continue
            dim = row.get("id")
            if not isinstance(dim, str):
                continue
            for key in ("prev", "next", "delta"):
                value = row.get(key)
                if isinstance(value, (int, float)) and not isinstance(value, bool):
                    owners.setdefault(abs(float(value)), set()).add(dim)
    return owners


def _sentences(text: str) -> list[str]:
    return [part for part in re.split(r"[。！？；\n]+", str(text or "")) if part.strip()]


def _misattributed_scores(value: str, owners: dict[float, set[str]]) -> list[str]:
    findings: list[str] = []
    for sentence in _sentences(value):
        named = _named_dims(sentence)
        if not named:
            continue
        for item in extract_numbers(sentence):
            if item["unit"] not in {"", "分"}:
                continue
            allowed_dims = owners.get(abs(item["value"]))
            if allowed_dims and not (allowed_dims & named):
                names = "、".join(sorted(DIM_NAMES.get(dim, dim) for dim in allowed_dims))
                written = "、".join(sorted(DIM_NAMES.get(dim, dim) for dim in named))
                findings.append(f"{item['raw'].strip()} 属于{names}，却写在了{written}里")
    return findings


def mechanism_hits(text: str) -> list[str]:
    """机制归因命中（hard）。

    窄规则：**同一句里「机制名词 + 归因动词」共现**才算，或者命中 `属于…错误/失误`。
    单独出现知识块原文里的词（"依赖学习阶段的编码质量"）不判，
    现有模板的三句正常话术也不判（见 policies 的注释与回归测试）。
    """
    findings: list[str] = []
    for sentence in _sentences(text):
        nouns = [noun for noun in MECHANISM_NOUNS if noun in sentence]
        if nouns and any(verb in sentence for verb in MECHANISM_VERBS):
            findings.extend(nouns)
        match = MECHANISM_BELONGS_RE.search(sentence)
        if match:
            findings.append(match.group(0))
    return list(dict.fromkeys(findings))


def _citation_findings(value: str, known_ids: set[str] | None) -> tuple[list[str], list[str] | None]:
    """`(占位字样, 有问题的编号列表)`；编号列表为 None = 引用行合格。

    只查**引用行**（`引用：…` / `参考：…`），引用行以外不认编号；
    本轮没有检索到任何知识块时调用方传 `known_ids=None`，退回旧行为（只看有没有标注）。
    """
    scope = "\n".join(CITATION_LINE_RE.findall(value)) or value
    placeholders = [word for word in CITATION_PLACEHOLDERS if word in scope]
    if known_ids is None:
        return placeholders, None
    lowered = {str(item).lower() for item in known_ids}
    cited = list(dict.fromkeys(KB_ID_RE.findall(scope)))
    if any(item.lower() in lowered for item in cited):
        return placeholders, None
    bogus = [item for item in cited if item.lower() not in lowered]
    # 空列表 = 一个编号都没写；非空 = 写了但都不是本轮检索到的知识块。
    return placeholders, bogus or [""]


def validate_text(
    text: str,
    allowed_numbers: list[float] | set[float] | None = None,
    policy: dict | None = None,
    score_owners: dict[float, set[str]] | None = None,
    chunk_ids: set[str] | None = None,
) -> dict:
    """Policy-driven validation. Issues carry a severity: a hard issue fails
    the answer (deterministic template takes over); a soft issue is recorded
    for telemetry but keeps the LLM answer (citation/scope-note, §5.1).

    `chunk_ids` = 本轮真正检索到的知识块编号。给了之后引用行必须命中其中一个真实编号
    （否则记 `citation_missing`），照抄提示词里的占位说明则记 `citation_placeholder`
    （2026-11-20 真实模型实测写的是「引用：知识块编号 · 标题」）。
    **两条都保持 soft**：引用问题不该把一份内容正确的回答打回模板。
    """
    rule = policy or policy_for(DEFAULT_SCENE)
    value = str(text or "").strip()
    if not value:
        return {"ok": False, "issues": [{"code": "empty", "detail": "回答为空", "severity": "hard"}], "chars": 0}
    issues: list[dict] = []
    chars = len(value)

    def add(code: str, detail: str, severity: str = "hard") -> None:
        issues.append({"code": code, "detail": detail, "severity": severity})

    limit = int(rule.get("max_chars", DEFAULT_MAX_CHARS))
    if chars > limit:
        add("too_long", f"回答过长：{chars} 字，上限 {limit} 字")
    banned = banned_word_hits(value, rule)
    if banned:
        add("banned_word", "命中禁用词：" + "、".join(banned))
    # 能力评级：ADR-0002 的硬红线，命中即 hard（不因为"只说了中等"就放行）。
    ratings = ability_rating_hits(value)
    if ratings:
        add("banned_word", "出现能力评级措辞：" + "、".join(ratings[:3]) + "（只谈任务条件与原始数字）")
    allowed = {float(v) for v in (allowed_numbers or [])}
    unsourced = [
        n
        for n in extract_numbers(value)
        if n["value"] not in allowed and n["unit"] not in {"°", "度"}
    ]
    if unsourced:
        add("unsourced_number", "数字不在 facts 中：" + "、".join(n["raw"] for n in unsourced))
    # 中文数字的度量表述（「一点八七秒」「两分五十秒」「百分之六十二」）：
    # `extract_numbers` 只认阿拉伯数字，不归一就等于给幻觉数字开后门。
    # 换算成数值后走的还是同一张白名单、同样精确命中，没有容差。
    cn_hits = chinese_measure_hits(value, allowed)
    if cn_hits:
        add(
            "unsourced_number",
            "中文数字写法换算后不在 facts 中：" + "、".join(cn_hits[:3])
            + "（应写成 1870 毫秒 / 1.87 秒这样的阿拉伯数字）",
        )

    if score_owners:
        misplaced = _misattributed_scores(value, score_owners)
        if misplaced:
            add("score_misattributed", "参考分写错了维度：" + "；".join(misplaced[:3]))

    # 机制归因：给数字编造没有读数支撑的内部过程（"属于目标符号本身错误"、
    # "可能存在混淆/回忆效率有待提升"）= 错结论，hard 回退模板（ADR-0002 决策 4）。
    mechanisms = mechanism_hits(value)
    if mechanisms:
        add(
            "mechanism_speculation",
            "编造了指标里没有的认知机制：" + "、".join(mechanisms[:3]) + "（只陈述数值与任务条件）",
        )

    citation_mode = rule.get("require_citation", "soft")
    severity = "hard" if citation_mode == "hard" else "soft"
    if citation_mode != "off":
        placeholders, bogus = _citation_findings(value, chunk_ids)
        # 占位符与"没有真实编号"是同一个毛病的两副面孔，只报最准的那一条，
        # 免得 telemetry 里 citation_placeholder 被 citation_missing 淹掉。
        if placeholders:
            add(
                "citation_placeholder",
                "引用行抄了提示词里的占位说明：" + "、".join(placeholders) + "（应写本轮真实编号与标题）",
                "soft",
            )
        elif bogus:
            missing = [item for item in bogus if item]
            add(
                "citation_missing",
                "引用行里没有本轮检索到的知识块编号"
                + ("：" + "、".join(missing[:3]) if missing else "（整行没有编号）"),
                severity,
            )
        elif chunk_ids is None and not CITATION_RE.search(value):
            add("citation_missing", "缺少来源标注", severity)
    scope_mode = rule.get("require_scope_note", "soft")
    if scope_mode != "off" and not any(marker in value for marker in SCOPE_MARKERS):
        add("scope_note_missing", "缺少“不能说明什么”声明", "hard" if scope_mode == "hard" else "soft")

    hard = [issue for issue in issues if issue["severity"] == "hard"]
    return {"ok": not hard, "issues": issues, "chars": chars}


SCORING_NOTE = "分数不在这里给出，由服务端按公开口径折算，口径版本见报告页。"


def _readable_facts(facts: dict) -> dict:
    """只看真能解读的维度（有至少一个可读原始字段），trend 键不算结果数据。"""
    return {
        dim: metrics
        for dim, metrics in (facts or {}).items()
        if dim in DIM_NAMES and isinstance(metrics, dict) and metric_clauses(dim, metrics)
    }


def template_explanation(facts: dict, question: str = "", chunk_ids: set[str] | None = None) -> str:
    """对话页的确定性兜底：按"用户问的是什么"给内容，而不是永远吐一份指标清单。

    两条硬性纪律：
      * 只复述**取到的**字段（`templates.metric_clauses`），取不到的整句跳过 ——
        用户实测到的「知觉速度 None 秒内完成 None 题、正确 14」就是旧版硬拼
        `seconds`/`trials` 造成的，新版 ps 上报的是 enc*/cat*；
      * 问"建议/下一步/明天测什么"时给可执行建议（带真实引用），
        而不是把四项指标重列一遍。
    """
    data = _readable_facts(facts or {})
    asked = dims_in_question(str(question or ""))
    advice_ask = is_advice_ask(str(question or ""))
    citations = chunk_ids or set()

    focus = [dim for dim in DIM_ORDER if dim in data and (not asked or dim in asked)]
    lines = []
    for dim in focus:
        clauses = metric_clauses(dim, data[dim])
        if clauses:
            lines.append(f"· {DIM_NAMES[dim]}：" + "；".join(clauses))

    if not lines:
        return (
            "本次还没有可解读的原始指标（这一档没有留下可读的作答记录）。"
            "完成一次测评后，这里才能针对具体维度解释数字怎么读、下一步怎么做。"
        )

    parts: list[str] = []
    if is_explain_what_ask(str(question or "")) and not advice_ask:
        # 「这项测什么」→ 先讲任务形式，再给本次数字；不给练习建议。
        # 但如果同时含「建议/下一步/明天」这类诉求（"我明天建议测什么"），
        # 仍然按建议走——那是在问下一步做什么。
        targets = asked or focus
        explained = [
            f"{DIM_NAMES[dim]}测的是{DIM_MEASURES[dim]}"
            for dim in targets
            if dim in DIM_MEASURES
        ]
        if explained:
            parts.append("；".join(explained) + "。")
            parts.append("")
        parts.append("本次相关维度的记录是：")
        parts.extend(lines)
    elif advice_ask:
        targets = asked or weak_dims(data) or focus
        parts.append("下一步可以这样安排：")
        for dim in targets[:2]:
            tip, source_id = SPECIFIC_SUGGESTIONS.get(dim, (None, None))
            if not tip:
                continue
            tail = f"（引用：{source_id}）" if source_id in citations else ""
            parts.append(f"· {DIM_NAMES[dim]} · {tip}{tail}")
        plan_ids = sorted(citation for citation in citations if citation.startswith("kb-plan"))
        if plan_ids:
            parts.append(f"· 练习分散到不同日子，比一次性长时间重复更稳（引用：{plan_ids[0]}）。")
        parts.append(
            "· 想看到可比的变化，请隔一周以上再复测同一档位；"
            "间隔太短，练习效应会让差值不好解释。"
        )
        parts.append("")
        parts.append("这次相关维度的原始数字是：")
        parts.extend(lines)
    elif asked:
        if len(asked) == 1:
            parts.append(f"你问的是{DIM_NAMES[asked[0]]}，本次该项的记录是：")
        else:
            parts.append("你问的是" + "、".join(DIM_NAMES[dim] for dim in asked) + "，本次这几项的记录是：")
        parts.extend(lines)
        parts.append("")
        for dim in asked:
            if dim in data:
                parts.append(f"怎么读：{reading_sentence(dim, data[dim])}")
        tip, source_id = SPECIFIC_SUGGESTIONS.get(asked[0], (None, None))
        if tip:
            tail = f"（引用：{source_id}）" if source_id in citations else ""
            parts.append("可以试试：")
            parts.append(f"· {tip}{tail}")
    else:
        parts.append("本次完成的原始指标：")
        parts.extend(lines)
        parts.append("")
        parts.append("想细看某一项，可以直接说出维度名，比如「联想记忆为什么低」「知觉速度怎么练」。")

    parts.append("")
    parts.append("这些只是本次测得的原始数据，不是分数，也不与人群比较。")
    parts.append(SCORING_NOTE)
    return "\n".join(parts)


def scene_template(state: dict) -> str:
    """Deterministic fallback per scene (no blank output on any degradation)."""
    scene = state.get("scene") or DEFAULT_SCENE
    facts = state.get("facts") or {}
    if scene == "report":
        return template_narrative(facts)
    if scene == "trend":
        return template_trend(facts.get("trend") or {})
    if scene == "summary":
        return template_analysis(facts, state.get("chunks") or [])
    return template_explanation(
        facts,
        str(state.get("question") or ""),
        {str(chunk.get("id") or "") for chunk in (state.get("chunks") or [])},
    )


def memory_lines(memory: dict | None) -> list[str]:
    if not memory:
        return []
    lines: list[str] = []
    profile = memory.get("profile") or {}
    if profile and profile.get("confirmed"):
        parts = []
        for key, label in (("goal", "目标"), ("preference", "偏好"), ("constraint", "约束")):
            if profile.get(key):
                parts.append(f"{label}：{profile[key]}")
        if parts:
            lines.append("用户画像（已确认）：" + "；".join(parts))
    if memory.get("summaryText"):
        lines.append("最近一条记忆摘要：" + str(memory["summaryText"]))
    advice = memory.get("advice") or []
    if advice:
        shown = "、".join(
            "「{}」{}{}".format(
                str(item.get("title") or item.get("id") or "")[:30],
                "（已完成）" if item.get("done") else "（未完成）",
                "" if item.get("title") else f"（编号 {item.get('id')}）",
            )
            for item in advice
        )
        lines.append(f"已给过的建议：{shown}。不要原样重复，可在其基础上递进。")
    return lines


def _facts_line(facts: dict) -> str:
    """给模型的本次指标一行一维，**行首带中文维度名**。

    两点实测依据：
      * 缺测字段（None / 空串 / 嵌套空列表）在这里就剔掉：把 `{'seconds': None}` 原样
        喂给模型，模型就会把 None 抄进中文回答（用户实测的「知觉速度 None 秒」有一半是
        这么来的）。数字仍然只来自 facts，校验白名单口径不变。
      * 旧版只写 `am: {...}` 这种英文短码，模型要自己猜"am=联想记忆"，实测就会把
        ps 的 12/2/1880 抄进"联想记忆"那句里（数字都在 facts 里，白名单拦不住，
        但结论已经错了）。行首给中文维度名，和 `dimension_score_owners` 用的
        同一套名字，模型与校验器口径一致。
    """
    parts = []
    for key, value in (facts or {}).items():
        if key == "trend":
            continue
        label = f"{DIM_NAMES[key]}（{key}）" if key in DIM_NAMES else key
        if isinstance(value, dict):
            clean = {
                metric: reading
                for metric, reading in value.items()
                if reading is not None and reading != "" and reading != []
            }
            if clean:
                parts.append(f"{label}: {clean}")
        elif value is not None and value != "" and value != []:
            parts.append(f"{label}: {value}")
    return "\n".join(parts)


def _trend_block(trend: dict) -> str:
    lines = []
    for row in trend.get("rows") or []:
        sign = "+" if row["delta"] > 0 else ""
        lines.append(f"· {row.get('name', row.get('id'))} {row['prev']} → {row['next']}（{sign}{row['delta']}）")
    skipped = sorted(set([*(trend.get("onlyPrev") or []), *(trend.get("onlyNext") or [])]))
    days = trend.get("days")
    tail = []
    if days is not None:
        tail.append(f"间隔 {days} 天" + ("（少于 7 天，练习效应可能影响结果）" if trend.get("repeatRisk") else ""))
    if skipped:
        tail.append("未参与对比的维度：" + "、".join(skipped))
    return "两次对比数据：\n" + "\n".join(lines) + ("\n" + "；".join(tail) if tail else "")


def build_messages(
    question: str,
    facts: dict,
    chunks: list[dict],
    history: list,
    memory: dict | None,
    scene: str = DEFAULT_SCENE,
) -> list[dict]:
    prior = [
        {
            "role": item.get("role") if item.get("role") == "assistant" else "user",
            "content": str(item.get("content") or ""),
        }
        for item in (history or [])[-6:]
    ]
    blocks = [
        "本次原始指标：\n" + (_facts_line(facts) or "（无）"),
        "可引用知识块：\n" + ("\n".join(f"{c['id']} · {c['title']}：{c['text']}" for c in chunks) or "（无）"),
    ]
    if chunks:
        # 引用行照抄这一行：把本轮真实存在的编号 · 标题逐条给出来。
        # 只写"知识块编号 · 标题"这种抽象说明，模型会把它当字面内容抄进回答
        # （2026-11-20 实测输出「引用：知识块编号 · 标题」）。
        blocks.append(
            "引用行请照抄下面任意一行（原样保留编号与标题，不要自己写编号，"
            "也不要把「知识块编号」「标题」这些说明词抄进回答）：\n"
            + "\n".join(
                f"引用：{chunk.get('id')} · {chunk.get('title', '')}".rstrip(" ·") for chunk in chunks[:3]
            )
        )
    if isinstance(facts, dict) and facts.get("trend"):
        blocks.append(_trend_block(facts["trend"]))
    extra = memory_lines(memory)
    if extra:
        blocks.append("用户背景（只用于调整表述，不作为数字来源）：\n" + "\n".join(extra))
    blocks.append("用户问题：" + question)
    # 时序修正：旧对话在前，当前问题在最后（此前把 history 拼在问题之后）。
    return [{"role": "system", "content": prompt_for(scene)}, *prior, {"role": "user", "content": "\n\n".join(blocks)}]


def _classify_node(state: AgentState) -> dict:
    if state.get("scene") == "report":
        return {"intent": INTENT["EXPLAIN"], "risk": "low", "matched": [], "intentSource": "scene"}
    keyword = classify(state.get("question", ""))
    intent, source = keyword["intent"], "rule"
    matched = list(keyword["matched"])

    # 关键词拿不准时才问模型（危机/越界等安全意图根本不会走到这里）。
    if needs_llm_fallback(keyword):
        facts = state.get("facts") or {}
        # 维度读数与趋势是两份不同的数据：有趋势不代表有本次结果，反之亦然。
        has_dims = any(dim != "trend" and isinstance(value, dict) for dim, value in facts.items())
        llm_intent = classify_with_llm(state.get("question", ""), state.get("history"))
        intent, source = resolve_intent(
            keyword,
            llm_intent,
            has_facts=has_dims,
            has_trend=isinstance(facts.get("trend"), dict),
        )
        if source == "llm":
            matched = [f"llm:{intent}"]

    # TREND 意图自动切换 scene，让校验与模板走趋势策略；其余保持入口 scene。
    update: dict = {
        "intent": intent,
        "risk": RISK_BY_INTENT.get(intent, "low"),
        "matched": matched,
        "intentSource": source,
    }
    if intent == INTENT["TREND"]:
        update["scene"] = "trend"
    if intent == INTENT["SUMMARY"]:
        update["scene"] = "summary"
    return update


def _retrieve_node(state: AgentState) -> dict:
    db = _DB.get()
    if db is None:
        return {"chunks": []}
    if state.get("intent") == INTENT["SUMMARY"]:
        chunks = retrieve_context(
        db, state.get("facts") or {}, limit=8, question=str(state.get("question") or "")
    )
    else:
        chunks = retrieve_kb(db, state.get("question", ""), limit=3)
    return {
        "chunks": chunks,
        "citations": [c["id"] for c in chunks],
        "sources": [
            {
                "id": c["id"],
                "title": c.get("title", ""),
                "text": c.get("text", ""),
                "source": c.get("source") or {},
            }
            for c in chunks
        ],
    }


def _fixed_node(state: AgentState) -> dict:
    intent = state.get("intent", INTENT["UNRELATED"])
    text = fixed_reply(intent)
    if intent == INTENT["GREETING"] and not _readable_facts(state.get("facts") or {}):
        # 还没有任何可解读结果时，寒暄必须先把能力边界说清（A1），
        # 而不是抛一句"你可以问你的认知怎么样"却根本不答得出来。
        text = GREETING_NO_FACTS
    return {
        "text": text,
        "source": "policy",
        "code": f"intent:{intent}",
        "risk": state.get("risk") or RISK_BY_INTENT.get(intent, "low"),
    }


def _no_trend_node(state: AgentState) -> dict:
    return {
        "text": FIXED_REPLY[INTENT["TREND_NO_DATA"]],
        "source": "template",
        "code": "trend_no_data",
    }


def _generate_node(state: AgentState) -> dict:
    scene = state.get("scene") or DEFAULT_SCENE
    facts = state.get("facts") or {}
    chunks = state.get("chunks") or []
    summary = state.get("intent") == INTENT["SUMMARY"] or scene == "report"
    domain_hit = any(word in (state.get("matched") or []) for word in DOMAIN_WORDS)
    trend_question = state.get("intent") == INTENT["TREND"] or scene == "trend"
    if (
        not chunks
        and not trend_question
        and not summary
        and (not domain_hit or not _facts_line(facts))
    ):
        return {"chunks": [], "text": NO_KNOWLEDGE_REPLY, "code": "no_knowledge", "source": "template"}
    db = _DB.get()
    fallback = template_analysis(facts, chunks) if summary else scene_template(state)
    if db is None:
        return {"text": fallback, "source": "template", "code": "unknown"}
    config = site_llm_config()
    if not config.enabled:
        return {"text": fallback, "source": "template", "code": "not_configured"}
    started = time.monotonic()
    try:
        messages = (
            build_analysis_messages(facts, chunks, state.get("question", ""))
            if summary
            else build_messages(
                state.get("question", ""),
                facts,
                chunks,
                state.get("history") or [],
                state.get("memory") if settings.memory_in_prompt else None,
                scene,
            )
        )
        if settings.llm_structured:
            # 结构化输出：在 system 里追加 JSON 约束；解析失败自动回退纯文本。
            messages = [
                *messages,
                {"role": "system", "content": STRUCTURED_INSTRUCTION},
            ]
        reply = call_llm_with_fallback(
            config,
            messages,
            max_tokens=3000 if summary else settings.llm_max_tokens,
        )
        latency = int((time.monotonic() - started) * 1000)
        text = reply.text
        if settings.llm_structured:
            parsed = parse_structured(
                reply.text, [str(chunk.get("id") or "") for chunk in chunks]
            )
            if parsed:
                text = parsed["text"]
        return {"text": text, "source": "llm", "code": "ok", "model": reply.model, "latency_ms": latency}
    except LLMError as exc:
        return {
            "text": fallback,
            "source": "template",
            "code": exc.code,
            "latency_ms": int((time.monotonic() - started) * 1000),
        }
    except Exception:
        return {
            "text": fallback,
            "source": "template",
            "code": "unknown",
            "latency_ms": int((time.monotonic() - started) * 1000),
        }


def _validate_node(state: AgentState) -> dict:
    if state.get("source") != "llm":
        return {"valid": True, "issues": []}
    rule = dict(policy_for(state.get("scene")))
    chunks = state.get("chunks") or []
    if not chunks:
        # 知识块为空时不要求引用（facts-only 回答是合法分级，见 §3 RAG 行）。
        rule["require_citation"] = "off"
    allowed_numbers = derived_allowed_numbers(state.get("facts"))
    score_owners = dimension_score_owners(state.get("facts"))
    chunk_ids = {str(chunk.get("id") or "") for chunk in chunks if chunk.get("id")} or None
    result = validate_text(
        state.get("text", ""),
        allowed_numbers=allowed_numbers,
        policy=rule,
        score_owners=score_owners,
        chunk_ids=chunk_ids,
    )
    # 绝对化表述校验：事实里有答对项，却写「全部错误/完全不会」→ 硬失败，走模板。
    # 真实模型实测把「知觉速度错了 3 题」写成「全部错误」，这类失真必须拦。
    if ABSOLUTE_CLAIM_RE.search(state.get("text", "")) and has_positive_correct(
        state.get("facts")
    ):
        result = {
            "ok": False,
            "issues": [
                *result["issues"],
                {
                    "code": "absolute_claim",
                    "detail": "出现「全部错误/完全不会」等绝对化描述，但原始指标里有答对项",
                    "severity": "hard",
                },
            ],
            "chars": len(state.get("text", "")),
        }
    if result["ok"]:
        soft = [issue["code"] for issue in result["issues"] if issue["severity"] == "soft"]
        issues = list(result["issues"])
        text = state.get("text", "")
        # 边界声明是产品底线，不该因为模型漏写就让用户看到没有声明的回答：
        # 这里直接补写固定声明，并把该 soft 问题标记为已修复（其余 soft 仍上报）。
        if "scope_note_missing" in soft:
            text = f"{text.rstrip()}\n\n{SCOPE_BACKFILL}".strip()
            issues = [issue for issue in issues if issue["code"] != "scope_note_missing"]
            soft = [code for code in soft if code != "scope_note_missing"]
        out: dict = {
            "valid": True,
            "text": text,
            "issues": issues,
            "validation": issues,
        }
        if soft:
            out["code"] = soft[0]
        return out
    hard = [issue for issue in result["issues"] if issue["severity"] == "hard"]
    # 缺陷**只在措辞**（能力评级词）时：改写措辞后重新校验，而不是把整份内容扔掉。
    # 第 3 轮实测「我哪方面比较强」4/4 次被「表现较好」判死 → 这个问题永远看不到模型答案。
    # 红线是"Agent 只能错措辞，不能错分数/结论"：能改对措辞就该留下内容。
    # 数字无依据、跨维度、机制编造、临床词都不参与改写 —— 那些不是措辞问题。
    if hard and all(str(issue.get("detail", "")).startswith("出现能力评级措辞") for issue in hard):
        repaired = repair_rating_wording(state.get("text", ""))
        if repaired != state.get("text", ""):
            retry = validate_text(
                repaired,
                allowed_numbers=allowed_numbers,
                policy=rule,
                score_owners=score_owners,
                chunk_ids=chunk_ids,
            )
            if retry["ok"]:
                issues = list(retry["issues"])
                issues.append(
                    {"code": "wording_repaired", "detail": "已把评级措辞改写为中性表述", "severity": "soft"}
                )
                soft = [issue["code"] for issue in issues if issue["severity"] == "soft"]
                # code 固定报 wording_repaired：改写这件事比"缺引用"更有调教价值，
                # 其余 soft 问题（citation_missing 等）仍完整留在 validation 里。
                return {
                    "valid": True,
                    "text": repaired,
                    "issues": issues,
                    "validation": issues,
                    "code": "wording_repaired",
                    "repaired": True,
                    "softCodes": soft,
                }
    summary = state.get("intent") == INTENT["SUMMARY"] or state.get("scene") == "report"
    facts = state.get("facts") or {}
    has_score = any(
        isinstance(metrics.get("score"), int)
        for metrics in facts.values()
        if isinstance(metrics, dict)
    )
    fallback = (
        template_analysis(facts, state.get("chunks") or [])
        if summary and has_score
        else scene_template(state)
    )
    # code 必须是**第一个 hard issue 的真实 code**（too_long / banned_word /
    # unsourced_number / score_misattributed / empty）。之前一律写死 "invalid"，
    # 用户和前端都看不到"为什么被回退"，调教时也丢掉了最有价值的一条线索。
    # 其余 issue（含同一条的更多细节）留在 validation 里给前端与 AIRun 遥测。
    return {
        "valid": False,
        "issues": result["issues"],
        "validation": result["issues"],
        "text": fallback,
        "source": "template",
        "code": str(hard[0]["code"]) if hard else "invalid",
    }


def _after_classify(state: AgentState) -> str:
    intent = state.get("intent")
    if state.get("scene") == "report":
        return "generate"
    if intent == INTENT["TREND"]:
        return "retrieve" if (state.get("facts") or {}).get("trend") else "no_trend"
    if intent in {INTENT["EXPLAIN"], INTENT["SUMMARY"]}:
        return "retrieve"
    return "fixed"


def _after_retrieve(state: AgentState) -> str:
    return "generate"


def _after_validate(state: AgentState) -> str:
    # Invalid LLM output already carries the deterministic template text.
    return "end"


def _build_graph():
    builder = StateGraph(AgentState)
    builder.add_node("classify", _classify_node)
    builder.add_node("retrieve", _retrieve_node)
    builder.add_node("generate", _generate_node)
    builder.add_node("validate", _validate_node)
    builder.add_node("fixed", _fixed_node)
    builder.add_node("no_trend", _no_trend_node)
    builder.set_entry_point("classify")
    builder.add_conditional_edges(
        "classify",
        _after_classify,
        {"retrieve": "retrieve", "fixed": "fixed", "generate": "generate", "no_trend": "no_trend"},
    )
    builder.add_conditional_edges("retrieve", _after_retrieve, {"generate": "generate"})
    builder.add_edge("generate", "validate")
    builder.add_conditional_edges("validate", _after_validate, {"end": END, "fixed": "fixed"})
    builder.add_edge("fixed", END)
    builder.add_edge("no_trend", END)
    return builder.compile()


_GRAPH = _build_graph()


def answer(
    db: Session | None,
    question: str,
    facts: dict,
    history: list,
    memory: dict | None,
    scene: str = DEFAULT_SCENE,
    chunks: list | None = None,
) -> dict:
    state: AgentState = {
        "question": question,
        "facts": facts,
        "history": history,
        "memory": memory or {},
        "scene": scene,
        "chunks": chunks or [],
        "citations": [c["id"] for c in (chunks or [])],
        "sources": [
            {
                "id": c["id"],
                "title": c.get("title", ""),
                "text": c.get("text", ""),
                "source": c.get("source") or {},
            }
            for c in (chunks or [])
        ],
        "risk": "low",
    }
    # 概念纠偏：命中常见误解时给一句确定性纠正，直接返回，不调用模型。
    # 次数上限写在 misconceptions 模块里（一次对话最多 2 次）。
    if scene == DEFAULT_SCENE:
        correction = should_correct(question, history)
        if correction:
            reply, kb_id = correction
            return {
                "intent": INTENT["EXPLAIN"],
                "intentSource": "rule",
                "risk": "low",
                "text": build_correction(reply, kb_id),
                "citations": [kb_id],
                "sources": [],
                "source": "template",
                "code": "correction",
            }
    token = _DB.set(db)
    try:
        result = _GRAPH.invoke(state, {"configurable": {"thread_id": "local"}})
    finally:
        _DB.reset(token)
    text = result.get("text", "")
    if result.get("source") == "llm":
        # 引用行只在校验时检查；展示统一走 citations 数组（前端已有引用行渲染）。
        text = TRAILING_CITATION_RE.sub("", text).rstrip()
    return {
        "intent": result.get("intent", INTENT["EXPLAIN"]),
        "intentSource": result.get("intentSource", "rule"),
        "risk": result.get("risk", "low"),
        "text": text,
        "citations": result.get("citations", []),
        "sources": result.get("sources", []),
        "source": result.get("source", "template"),
        "code": result.get("code", "ok"),
        "model": result.get("model"),
        "latency_ms": result.get("latency_ms"),
        "validation": result.get("validation") or result.get("issues") or [],
    }
