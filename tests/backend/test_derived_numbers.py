"""派生数字白名单回归：单位换算与百分比派生必须放行，幻觉数字必须拦住。

2026-11-20 用户人工实测（真实模型 glm-4-flash-250414，四个问题全回退模板）：

| 问题 | 被 hard 拦掉的 detail | 模型实际写的 | 合法吗 |
| --- | --- | --- | --- |
| 为什么联想记忆低？ | 数字不在 facts 中：1.87秒 | 1870 毫秒 → 1.87 秒 | ✅ 合法换算 |
| 我接下来该练什么？ | 数字不在 facts 中：62.5% | 5/8 正确率 = 62.5% | ✅ 合法派生 |
| 知觉速度怎么练 | 数字不在 facts 中：1.88 秒 ×4 | 1880 毫秒 → 1.88 秒 | ✅ 合法换算 |

**这就是「agent 回答不能让人满意」的主因**：模型给出了口径合规的正确回答，被旧的
派生白名单（`_derived_from_metrics` 只认 `meanRtMs` 一位小数、百分比只认整数）误杀，
用户只能看到模板。

本文件的纪律：白名单只按**显式变换**扩展，永远不做容差匹配 ——
所以「1870 毫秒 → 1.88 秒」这种只差 0.01 的数字必须仍然拦掉，
容差一开就是幻觉数字的口子（项目红线：可以错措辞，不能错分数）。
"""
from __future__ import annotations

import pytest

from app.agent import (
    build_messages,
    chinese_measure_hits,
    cn_number_to_float,
    derived_allowed_numbers,
    dimension_score_owners,
    extract_numbers,
    validate_text,
)
from app.agent.policies import policy_for

# 用户那一次会话的真实形状（meanRtMs 来自 vc/ps 上报，correctRts 来自 sv 上报）。
RT_FACTS = {"am": {"hits": 5, "falseAlarms": 3, "meanRtMs": 1870}}
USER_FACTS = {
    "vc": {"total": 8, "correct": 5, "meanRtMs": 2500, "score": 50},
    "ps": {"encCorrect": 12, "encWrong": 2, "catCorrect": 9, "catWrong": 3, "meanRtMs": 1880, "seconds": 45, "score": 71},
    "am": {"hits": 4, "falseAlarms": 3, "targets": 8, "firstTry": 5, "meanRtMs": 1870, "score": 26},
    "sv": {"total": 8, "correct": 6, "correctRts": [1500, 2100, 1880, 2500, 3000]},
}


def verdict(text: str, facts: dict = USER_FACTS, scene: str = "chat_explain"):
    return validate_text(
        text,
        allowed_numbers=derived_allowed_numbers(facts),
        policy=policy_for(scene),
        score_owners=dimension_score_owners(facts),
    )


def hard_codes(text: str, facts: dict = USER_FACTS) -> list[str]:
    return [issue["code"] for issue in verdict(text, facts)["issues"] if issue["severity"] == "hard"]


def values_in(facts: dict) -> set[float]:
    return derived_allowed_numbers(facts)


# ---------------------------------------------------------------------------
# 1) 毫秒 → 秒：对任何毫秒语义字段放行，保留 1–2 位小数
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "facts,ms,seconds",
    [
        ({"am": {"meanRtMs": 1870}}, 1870, 1.87),
        ({"am": {"meanRtMs": 1870}}, 1870, 1.9),
        ({"ps": {"meanRtMs": 1880}}, 1880, 1.88),
        ({"vc": {"meanRtMs": 2500}}, 2500, 2.5),
        ({"vc": {"meanRtMs": 2500}}, 2500, 2.5),
        ({"sv": {"correctRts": [1500, 2100, 3000]}}, 2100, 2.1),
        ({"sv": {"correctRts": [1500, 2100, 3000]}}, 3000, 3.0),
        ({"vc": {"medianRtMs": 1875}}, 1875, 1.88),  # 十进制四舍五入，不是银行家舍入
        ({"ps": {"mean_rt_ms": 1870}}, 1870, 1.87),  # snake_case 也算毫秒语义
    ],
)
def test_ms_to_seconds_is_whitelisted(facts, ms, seconds):
    assert float(ms) in values_in(facts)  # 原始毫秒值本来就在 facts 里
    assert seconds in values_in(facts), (ms, seconds)


@pytest.mark.parametrize(
    "text",
    [
        "联想记忆平均每次作答 1.87 秒。仅供参考。",
        "联想记忆平均每次作答 1.87秒。仅供参考。",
        "联想记忆平均每次作答约 1.9 秒。仅供参考。",
        "言语理解平均每次作答 2.5 秒。仅供参考。",
        "知觉速度平均每次作答 1.88 秒。仅供参考。",
        "空间视觉化最快一题 1.5 秒。仅供参考。",
    ],
)
def test_converted_seconds_pass_validation(text):
    assert hard_codes(text) == [], (text, verdict(text)["issues"])


# ---------------------------------------------------------------------------
# 2) 百分比：比率派生同时给 1 位小数与整数（旧的只有整数）
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "facts,pct",
    [
        ({"vc": {"total": 8, "correct": 5}}, 62.5),
        ({"am": {"hits": 5, "falseAlarms": 3}}, 62.5),
        ({"am": {"hits": 5, "falseAlarms": 3}}, 62.0),
        ({"am": {"hits": 5, "falseAlarms": 3}}, 63.0),
        ({"sv": {"total": 8, "correct": 5}}, 62.5),
        ({"am": {"hits": 1, "falseAlarms": 2}}, 33.3),
    ],
)
def test_percentage_with_one_decimal_is_whitelisted(facts, pct):
    assert pct in values_in(facts), (facts, pct)


@pytest.mark.parametrize(
    "text,facts",
    [
        ("言语理解答对 5 题、共 8 题，正确率 62.5%。仅供参考。", RT_FACTS),
        ("再认命中 5 个、虚报 3 个，正确率 62.5%。仅供参考。", RT_FACTS),
        ("再认命中 5 个、虚报 3 个，正确率 63%。仅供参考。", RT_FACTS),
        # 1/(1+2) = 33.333…%：一位小数按四舍五入给 33.3，不是 33.33 也不是 33.4
        ("本次正确率约 33.3%。仅供参考。", {"am": {"hits": 1, "falseAlarms": 2}}),
    ],
)
def test_derived_percentage_passes_validation(text, facts):
    assert hard_codes(text, facts) == [], (text, verdict(text, facts)["issues"])


# ---------------------------------------------------------------------------
# 3) 红线：派生不出来的数字仍然必须 hard（**没有容差**）
# ---------------------------------------------------------------------------

def test_no_tolerance_for_seconds():
    """换算只能精确命中白名单里的形态：1870 毫秒 → 1.88 秒、1.873 秒都要拦。

    开容差 = 幻觉数字的口子，所以这条钉死在测试里。
    """
    allowed = values_in(RT_FACTS)
    assert 1.87 in allowed and 1.9 in allowed
    assert 1.88 not in allowed  # 与真值只差 0.01，也不放行
    assert 1.873 not in allowed  # 三位小数：提示词已要求只留 1–2 位
    for text in (
        "联想记忆平均每次作答 1.88 秒。仅供参考。",
        "联想记忆平均每次作答 1.873 秒。仅供参考。",
        "联想记忆平均每次作答 2.4 秒。仅供参考。",
    ):
        assert hard_codes(text, RT_FACTS) == ["unsourced_number"], text


def test_unknown_numbers_still_hard_blocked():
    """facts 里不存在、也派生不出的数字（91%、得分 88）仍然必须拦。"""
    allowed = values_in(RT_FACTS)
    assert 91.0 not in allowed and 88.0 not in allowed  # 前提：确实派生不出来
    for text in (
        "你的正确率是 91%。仅供参考。",
        "联想记忆得分 88。仅供参考。",
        "本次平均反应时 1870 毫秒，正确率 91.5%。仅供参考。",
    ):
        assert "unsourced_number" in hard_codes(text, RT_FACTS), text


def test_score_and_rt_ratios_no_longer_invent_junk_integers():
    """四维真实 facts 下，旧口径会把 `score/(score+correct)`、`rt/(rt+count)` 也当成"正确率"。

    实测：旧派生集里 91（=50/55）和 147（=71/48）都存在 —— 模型随口写的假分数
    因此能过关。现在百分比只认真实口径的部分÷整体，这两个数派生不出来了。
    """
    allowed = values_in(USER_FACTS)
    assert 91.0 not in allowed, "score 比值不该造出 91%"
    assert 147.0 not in allowed, "秒与条数的比值不该造出 147"
    assert 1.87 in allowed and 1.88 in allowed and 2.5 in allowed  # 合法换算一个都没少
    assert hard_codes("你的正确率是 91%。仅供参考。", USER_FACTS) == ["unsourced_number"]


def test_invented_number_in_another_unit_is_still_blocked():
    """换算只认 ms↔s：把 1870 写成"0.52 分钟"这种二次换算不放行。"""
    allowed = values_in(RT_FACTS)
    assert 0.52 not in allowed
    assert hard_codes("联想记忆平均每次作答 0.52 分钟。仅供参考。", RT_FACTS) == ["unsourced_number"]


def test_non_millisecond_fields_are_not_divided_by_1000():
    """`seconds`/`score`/`total` 没有毫秒语义，不许被"换算"出一个秒数。"""
    facts = {"ps": {"seconds": 45, "score": 71, "total": 8}}
    allowed = values_in(facts)
    assert 0.045 not in allowed
    assert 0.071 not in allowed
    assert hard_codes("本次限时 0.05 秒。仅供参考。", facts) == ["unsourced_number"]


# ---------------------------------------------------------------------------
# 4) 单位归一：数字带不带单位、全角、千分位都不许影响数值比较
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "text",
    [
        "平均每次作答 1.87 秒。仅供参考。",
        "平均每次作答 1.87秒。仅供参考。",
        "平均每次作答 1.87s。仅供参考。",
        "平均每次作答 1,870 毫秒。仅供参考。",
        "平均每次作答 1870ms。仅供参考。",
        "平均每次作答１.８７秒。仅供参考。",  # 全角小数点与全角数字
    ],
)
def test_unit_and_glyph_variants_all_compare_the_same_value(text):
    assert hard_codes(text, RT_FACTS) == [], (text, extract_numbers(text))


def test_fullwidth_digits_are_not_a_bypass():
    """归一是双向的：全角写法同样要被看见，否则 ９１％ 就绕过了校验。"""
    assert extract_numbers("正确率 ９１％") [0]["value"] == 91.0
    assert "unsourced_number" in hard_codes("你的正确率是 ９１％。仅供参考。", RT_FACTS)


def test_thousands_comma_is_one_number_not_two():
    items = extract_numbers("平均反应时 1,870 毫秒")
    assert [item["value"] for item in items] == [1870.0], items


def test_chinese_numeral_times_are_converted_and_checked_not_skipped():
    """真实模型把 meanRtMs 2500 写成「两分五十秒」（=170 秒）：中文数字过去完全看不见。

    现在的口径是**换算成数值再走同一张白名单**，所以：
      * 错的读数（170 秒、147 秒）照样 hard；
      * 照抄 facts 的中文读数（四十五秒 = seconds 45）照样放行，不因为写法回退模板。
    """
    assert hard_codes("平均用时两分五十秒。仅供参考。", USER_FACTS) == ["unsourced_number"]
    assert hard_codes("联想记忆平均一分八十七秒。仅供参考。", USER_FACTS) == ["unsourced_number"]
    assert hard_codes("知觉速度限时四十五秒。仅供参考。", USER_FACTS) == []
    assert hard_codes("平均一点八七秒。仅供参考。", USER_FACTS) == []


def test_chinese_numeral_percent_is_converted_and_checked():
    assert cn_number_to_float("六十二点五") == 62.5
    assert hard_codes("正确率百分之六十二点五。仅供参考。", USER_FACTS) == []
    assert "unsourced_number" in hard_codes("正确率百分之九十一。仅供参考。", USER_FACTS)


@pytest.mark.parametrize(
    "phrase,expected",
    [
        ("四十五", 45.0),
        ("一点八七", 1.87),
        ("一千八百七十", 1870.0),
        ("十五", 15.0),
        ("一百八十", 180.0),
        ("两点五", 2.5),
    ],
)
def test_cn_number_to_float(phrase, expected):
    assert cn_number_to_float(phrase) == expected


def test_cn_number_to_float_rejects_non_numerals():
    assert cn_number_to_float("两分") is None  # 带单位的口语片段不当数字
    assert cn_number_to_float("几分几秒") is None
    assert cn_number_to_float("") is None
    assert chinese_measure_hits("每天练五分钟", set()) == []


def test_colloquial_chinese_is_not_mistaken_for_a_metric():
    """「每天练五分钟」「下一秒」「第一次」不是读数，不能误杀成模板回退。"""
    for text in (
        "每天练五分钟，效果更稳。仅供参考。",
        "把练习拆成几组，下一秒就能开始。仅供参考。",
        "这是第一次测，第二秒就作答不代表能力。仅供参考。",
    ):
        assert hard_codes(text, USER_FACTS) == [], (text, verdict(text, USER_FACTS)["issues"])


# ---------------------------------------------------------------------------
# 5) 原有红线不许放松：跨维度张冠李戴、评级措辞
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "text",
    [
        "联想记忆得分 50，说明你只回忆出 5 组。仅供参考。",
        "联想记忆的平均每次作答 2.5 秒，得分 50。仅供参考。",  # 秒数合法，分数照样抓
        "言语理解的表现由 1.87 秒与得分 26 决定。仅供参考。",
    ],
)
def test_cross_dimension_score_is_still_hard_blocked(text):
    codes = hard_codes(text)
    assert "score_misattributed" in codes, (text, codes)


def test_dimension_local_seconds_are_not_a_blanket_pass():
    """2.5 秒属于言语理解、1.88 秒属于知觉速度：换算合法但维度不能乱扣分数。"""
    assert 2.5 in values_in(USER_FACTS) and 1.88 in values_in(USER_FACTS)
    assert "score_misattributed" in hard_codes("知觉速度得分 50，平均 1.88 秒。仅供参考。")


@pytest.mark.parametrize(
    "text",
    [
        "联想记忆 1.87 秒，这表明在回忆速度上表现中等。仅供参考。",
        "知觉速度平均 1.88 秒，你的能力较强。仅供参考。",
        "正确率 62.5%，整体处于中等水平。仅供参考。",
    ],
)
def test_ability_rating_wording_is_still_hard_blocked(text):
    codes = hard_codes(text)
    assert "banned_word" in codes, (text, codes)


def test_disclaimer_sentence_still_passes():
    """免责句里的评级词仍然放行（三层判定不许因为加白名单而改动）。"""
    assert hard_codes("这些数字不能说明你能力较弱，也不与人群比较。仅供参考。") == []


# ---------------------------------------------------------------------------
# 6) 图级：用户实测那三句真话不再被打回模板
# ---------------------------------------------------------------------------

def _graph(monkeypatch, question, facts, reply_text):
    from types import SimpleNamespace

    from app import agent as A

    from app.agent import graph as G
    from app.llm import LLMConfig, LLMReply

    class FakeDb:
        def scalar(self, _stmt):
            return None

        def scalars(self, _stmt):
            return SimpleNamespace(all=lambda: [])

    monkeypatch.setattr(G, "retrieve_kb", lambda db, query, limit=3: [])
    monkeypatch.setattr(G, "call_llm_with_fallback",
        lambda config, messages, **kwargs: LLMReply(text=reply_text, model="test-model"),
    )
    monkeypatch.setattr(G, "site_llm_config",
        lambda: LLMConfig(endpoint="https://fake/v1", model="test-model", key="sk-test", enabled=True),
    )
    return A.answer(FakeDb(), question, facts, [], None)


@pytest.mark.parametrize(
    "question,facts,reply",
    [
        (
            "为什么联想记忆低？",
            USER_FACTS,
            "联想记忆这次首次配对成功 5/8 组，平均每次作答 1.87 秒；这些数字只反映本次任务。",
        ),
        (
            "我接下来该练什么？",
            USER_FACTS,
            "可以先练联想记忆。言语理解答对 5 题、共 8 题，正确率 62.5%。仅供参考。",
        ),
        (
            "知觉速度怎么练",
            USER_FACTS,
            "限时 45 秒里知觉速度平均每次作答 1.88 秒，先把准确放在速度前面。仅供参考。",
        ),
    ],
)
def test_legit_converted_answers_keep_the_llm(monkeypatch, question, facts, reply):
    """旧白名单下这三条全是 template/unsourced_number —— 现在必须 source=llm。"""
    result = _graph(monkeypatch, question, facts, reply)
    assert result["source"] == "llm", (result["code"], result["validation"])
    assert result["code"] in ("ok", "citation_missing", "scope_note_missing"), result["code"]


def test_hallucinated_answer_still_falls_back_to_template(monkeypatch):
    result = _graph(
        monkeypatch,
        "为什么联想记忆低？",
        RT_FACTS,
        "联想记忆的正确率是 91%，平均 1.88 秒。仅供参考。",
    )
    assert result["source"] == "template"
    assert result["code"] == "unsourced_number", result["code"]
    assert "91" not in result["text"]


def test_facts_rows_are_labelled_with_chinese_dimension_names():
    """给模型的那一行必须自带中文维度名：白名单是跨维度的，靠模型自己认 `am:` 会串数据。"""
    block = build_messages("为什么联想记忆低？", USER_FACTS, [], [], None)[-1]["content"]
    assert "联想记忆（am）" in block, block
    assert "知觉速度（ps）" in block, block
    assert "trend" not in block.split("用户问题")[0].replace("meanRtMs", "")  # trend 键不进指标行


# ---------------------------------------------------------------------------
# 7) 提示词侧配合：换算要放行，但形态必须落在白名单里
# ---------------------------------------------------------------------------

def test_prompts_allow_conversion_but_pin_the_form():
    """放行换算 + 限定写法：三位小数与中文时间读法都是实测踩过的坑。"""
    from app.analysis import ANALYSIS_PROMPT
    from app.agent.policies import prompt_for

    for prompt in (prompt_for("chat_explain"), prompt_for("summary"), ANALYSIS_PROMPT):
        assert "阿拉伯数字" in prompt, prompt
        assert "1–2 位小数" in prompt or "1-2 位小数" in prompt, prompt
        assert "1.87" in prompt or "2.5" in prompt, prompt  # 举出可用的具体形态
    assert "1.873" in prompt_for("chat_explain")  # 明确禁止三位小数


def test_policy_flags_were_not_loosened():
    """红线：不许提高字数上限，也不许把 require_* 改成 off（report 引用行本来就是 off）。"""
    from app.agent.policies import SCENE_POLICIES

    assert policy_for("chat_explain")["max_chars"] == 360
    assert SCENE_POLICIES["chat_explain"]["require_citation"] == "soft"
    assert SCENE_POLICIES["chat_explain"]["require_scope_note"] == "soft"
    assert SCENE_POLICIES["trend"]["require_citation"] == "soft"
    assert SCENE_POLICIES["trend"]["require_scope_note"] == "soft"
    assert SCENE_POLICIES["summary"]["require_citation"] == "soft"
    assert SCENE_POLICIES["report"]["require_scope_note"] == "soft"
    for scene, rule in SCENE_POLICIES.items():
        assert rule["require_scope_note"] != "off", scene
