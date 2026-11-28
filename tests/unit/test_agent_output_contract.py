"""Agent 输出口径回归：校验失败要说清真原因、评级词必须拦、兜底文案不许出现 None。

对应 2026-11-20 用户人工测试反馈（A1 诚实性 / A2 可追溯 / A5 拦截可理解 / A6 等待可感知）：
  1. `_validate_node` 曾经把失败原因统一写成 "invalid"，真实 issue（too_long /
     banned_word / unsourced_number / score_misattributed）全被吞掉；
  2. 兜底模板按旧版字段硬拼 ps 的 seconds/trials，打出「知觉速度 None 秒内完成 None 题」；
  3. chat_explain 的 200 字上限让中文正常回答必然违规 → 用户永远看到模板；
  4. 模型写「表现中等」这种能力评级曾被放行，违反"不推断能力高低"红线。
"""
from __future__ import annotations

import pytest

from types import SimpleNamespace

from app import agent as A

from app.agent import graph as G
from app.agent import (
    ability_rating_hits,
    answer,
    build_messages,
    classify,
    derived_allowed_numbers,
    dimension_score_owners,
    template_explanation,
    validate_text,
)
from app.agent.policies import SCENE_POLICIES, policy_for, prompt_for
from app.llm import LLMConfig, LLMReply
from app.templates import metric_clauses, template_narrative

FACTS = {
    "vc": {"total": 8, "correct": 5, "score": 50},
    "am": {"hits": 4, "falseAlarms": 3, "score": 26},
}
KB_CHUNKS = [{"id": "kb-dim-am-01", "title": "联想记忆怎么练", "text": "按场景分组记忆词对。"}]


def run_graph(monkeypatch, question, facts, reply_text, chunks=KB_CHUNKS, scene="chat_explain"):
    """跟 test_agent_workflow 同一套假 db / 假模型，CI 不需要真 Key。"""

    class FakeDb:
        def scalar(self, _stmt):
            return None

        def scalars(self, _stmt):
            return SimpleNamespace(all=lambda: list(chunks))

    def fake_retrieve(db, query, limit=3):
        return list(chunks)

    def fake_call_llm(config, messages, **kwargs):
        return LLMReply(text=reply_text, model="test-model")

    monkeypatch.setattr(G, "retrieve_kb", fake_retrieve)
    monkeypatch.setattr(G, "call_llm_with_fallback", fake_call_llm)
    monkeypatch.setattr(G, "site_llm_config",
        lambda: LLMConfig(
            endpoint="https://fake/v1", model="test-model", key="sk-test", enabled=True
        ),
    )
    return answer(FakeDb(), question, facts, [], None, scene=scene)


def run_template(monkeypatch, question, facts, chunks=KB_CHUNKS, scene="chat_explain"):
    """站点没配模型时的路径（用户手动测试大多先落在这里）。"""

    class FakeDb:
        def scalar(self, _stmt):
            return None

        def scalars(self, _stmt):
            return SimpleNamespace(all=lambda: list(chunks))

    monkeypatch.setattr(G, "retrieve_kb", lambda db, query, limit=3: list(chunks))
    monkeypatch.setattr(G, "site_llm_config",
        lambda: LLMConfig(endpoint="", model="", key="", enabled=False),
    )
    return answer(FakeDb(), question, facts, [], None, scene=scene)


# ---------------------------------------------------------------------------
# 根因 1：校验失败必须返回真实 code
# ---------------------------------------------------------------------------

def test_too_long_returns_real_code(monkeypatch):
    limit = policy_for("chat_explain")["max_chars"]
    reply = "字" * (limit + 1)
    result = run_graph(monkeypatch, "联想记忆为什么低？", FACTS, reply)
    assert result["source"] == "template"
    assert result["code"] == "too_long", result["code"]


def test_banned_word_returns_real_code(monkeypatch):
    result = run_graph(
        monkeypatch, "联想记忆为什么低？", FACTS, "这可能是轻度认知障碍。仅供参考。"
    )
    assert result["source"] == "template"
    assert result["code"] == "banned_word", result["code"]


def test_unsourced_number_returns_real_code(monkeypatch):
    result = run_graph(
        monkeypatch,
        "为什么联想记忆低？",
        FACTS,
        "联想记忆正确率 97%。仅供参考。引用：kb-dim-am-01 · 联想记忆",
    )
    assert result["source"] == "template"
    assert result["code"] == "unsourced_number", result["code"]


def test_score_misattributed_returns_real_code(monkeypatch):
    result = run_graph(
        monkeypatch,
        "为什么联想记忆低？",
        FACTS,
        "联想记忆得分 50，说明你只回忆出 5 组。仅供参考。引用：kb-dim-am-01 · 联想记忆",
    )
    assert result["source"] == "template"
    assert result["code"] == "score_misattributed", result["code"]


def test_validation_keeps_every_issue_when_there_are_several(monkeypatch):
    limit = policy_for("chat_explain")["max_chars"]
    reply = "这可能是认知障碍。" + "字" * (limit + 1)
    result = run_graph(monkeypatch, "联想记忆为什么低？", FACTS, reply)
    codes = [issue["code"] for issue in result["validation"]]
    # 第一个 hard 进 code，其余留在 validation 给前端/遥测，不再只有一个 "invalid"。
    assert result["code"] == codes[0] == "too_long"
    assert "banned_word" in codes
    assert all({"code", "detail", "severity"} <= set(issue) for issue in result["validation"])
    assert all(issue["detail"] for issue in result["validation"])


def test_empty_model_output_returns_empty_code(monkeypatch):
    result = run_graph(monkeypatch, "联想记忆为什么低？", FACTS, "   ")
    assert result["source"] == "template"
    assert result["code"] == "empty", result["code"]


# ---------------------------------------------------------------------------
# 追加红线：能力评级词（用户实测模型写的原话必须被拦）
# ---------------------------------------------------------------------------

MODEL_RATING_REPLY = (
    "联想记忆任务中，正确回忆了6组，总共有8组。每组回忆所需时间均为2500毫秒，任务得分为71。"
    "这表明你在回忆速度和准确性上能力较强。这些数字不能说明联想记忆能力的高低。"
)
RATING_FACTS = {
    "am": {"targets": 8, "firstTry": 6, "meanRtMs": 2500, "score": 71},
}


def test_ability_rating_sentence_is_hard_blocked():
    """「能力较强」这类稳定能力定级仍要拦掉；「表现较好」这类绑定本次任务的说法已放宽。"""
    result = validate_text(
        MODEL_RATING_REPLY,
        allowed_numbers=derived_allowed_numbers(RATING_FACTS),
        policy=policy_for("chat_explain"),
        score_owners=dimension_score_owners(RATING_FACTS),
    )
    assert not result["ok"], result["issues"]
    hard = [issue for issue in result["issues"] if issue["severity"] == "hard"]
    assert any(issue["code"] == "banned_word" for issue in hard)
    assert ability_rating_hits(MODEL_RATING_REPLY)


def test_ability_rating_wording_is_repaired_not_discarded(monkeypatch):
    """第 3 轮的行为变更：缺陷只在措辞时改写措辞，保留内容。

    旧行为是整条退回模板 —— 于是「我哪方面比较强」这类问题 4/4 次都只能看到模板，
    用户感受就是"agent 不会回答"。红线只要求不能错分数/结论，措辞可以就地改对。
    """
    result = run_graph(monkeypatch, "为什么联想记忆低？", RATING_FACTS, MODEL_RATING_REPLY)
    assert result["source"] == "llm", result
    assert result["code"] == "wording_repaired", result
    assert "能力较强" not in result["text"]
    assert "本次分数相对较高" in result["text"]
    # 关键：改写不能动数字
    assert "6" in result["text"] and "8" in result["text"] and "71" in result["text"]


def test_clinical_words_are_never_repaired(monkeypatch):
    """临床词不是措辞问题，是真越界：必须整条拦死，不许改写后放行。"""
    facts = {"am": {"hits": 4, "falseAlarms": 3, "score": 26}}
    reply = "联想记忆命中 4、虚报 3，得分 26，这可以诊断出注意力的问题。仅供参考。"
    result = run_graph(monkeypatch, "为什么联想记忆低？", facts, reply)
    assert result["source"] == "template", result
    assert result["code"] == "banned_word"
    assert "诊断" not in result["text"]


def test_rating_adjective_without_an_ability_object_is_allowed():
    """不能误伤任务条件描述——用户测试表要求"拦截可理解"，不是"拦截越多越好"。"""
    allowed_numbers = derived_allowed_numbers(RATING_FACTS)
    for sentence in (
        "这次作答速度较快，可能是谨慎取舍的结果。仅供参考。",
        "编码阶段答对 6 题，平均每次作答约 2.5 秒。仅供参考。",
        "这些数字不能说明你能力较弱，也不与人群比较。仅供参考。",
        "联想记忆这次相对突出，作答偏向先准再快。仅供参考。",
        "这次整体表现较好，但只反映本次任务。仅供参考。",
        "回答较短，只说三点。仅供参考。",
    ):
        result = validate_text(
            sentence, allowed_numbers=allowed_numbers, policy=policy_for("chat_explain")
        )
        assert result["ok"], (sentence, result["issues"])


def test_rating_phrases_are_all_blocked():
    for phrase in (
        "联想记忆水平较好。",
        "这属于中上水平。",
        "智力水平不受影响。",
        "你在记忆上有天赋。",
        "能力较弱。",
    ):
        assert ability_rating_hits(phrase + "仅供参考。"), phrase


def test_base_prompt_and_analysis_prompt_forbid_ratings():
    from app.analysis import ANALYSIS_PROMPT

    # 放宽后的口径：允许「相对突出/靠后」的倾向描述，仍禁智商/天赋/人格定级与量表换算。
    for prompt in (prompt_for("chat_explain"), prompt_for("summary"), ANALYSIS_PROMPT):
        assert "智商" in prompt and "天赋" in prompt
        assert "相对突出" in prompt
    assert "MoCA" in prompt_for("chat_explain")


# ---------------------------------------------------------------------------
# 根因 3：提示词与策略必须同源
# ---------------------------------------------------------------------------

def test_prompt_facts_block_never_shows_the_model_none():
    """另一半 None 的来源：facts 里的 null 字段被原样拼进 prompt，模型照抄。"""
    from app.analysis import facts_block

    dirty = {
        "vc": {"total": 8, "correct": 6, "meanRtMs": None, "itemIds": []},
        "ps": {"encCorrect": 12, "encWrong": 2, "seconds": None, "trials": None},
        "sv": {"total": None, "correct": None},
    }
    block = build_messages("知觉速度怎么样", dirty, [], [], None)[-1]["content"]
    assert "None" not in block, block
    assert "encCorrect" in block
    summary_block = facts_block(dirty)
    assert "None" not in summary_block, summary_block


def test_scene_prompts_quote_the_policy_length():
    """提示词写 200、校验按 360 拦，等于让模型必然违规。"""
    import re

    for scene in SCENE_POLICIES:
        prompt = prompt_for(scene)
        numbers = {int(match) for match in re.findall(r"不超过\s*(\d+)\s*字", prompt)}
        if numbers:
            assert max(numbers) == SCENE_POLICIES[scene]["max_chars"], (scene, numbers)


def test_chat_prompt_demands_a_direct_answer():
    prompt = prompt_for("chat_explain")
    assert "直接回答" in prompt
    assert "不要把原始指标重列一遍" in prompt


# ---------------------------------------------------------------------------
# 根因 2：兜底模板绝不把 None 打给用户
# ---------------------------------------------------------------------------

def test_metric_clauses_skip_every_missing_field():
    assert metric_clauses("ps", {"encCorrect": 12, "encWrong": 2}) == [
        "编码答对 12 题、答错 2 题"
    ]
    assert metric_clauses("ps", {"correct": 14}) == ["答对 14 题"]
    assert metric_clauses("ps", {}) == []
    assert metric_clauses("am", {"hits": None, "falseAlarms": 3}) == ["重试 3 次"]
    assert metric_clauses("vc", {"total": 8, "correct": None}) == ["共 8 题"]
    # 0 是合法读数，不能被当成"缺测"跳过
    assert metric_clauses("vc", {"total": 0, "correct": 0}) == ["答对 0 题"]
    assert metric_clauses("vc", {"total": 8, "correct": 0}) == ["8 题答对 0 题"]
    # 非数字（字符串/布尔/null）不算数据
    assert metric_clauses("vc", {"total": "8", "correct": None}) == []
    assert metric_clauses("sv", {"total": 8, "correct": True}) == ["共 8 题"]


def test_new_ps_metrics_render_without_none():
    """用户实测到的原句：「知觉速度 None 秒内完成 None 题、正确 14」。"""
    facts = {
        "ps": {
            "encCorrect": 12,
            "encWrong": 2,
            "catCorrect": 9,
            "catWrong": 3,
            "seconds": 45,
            "correct": 14,
        }
    }
    text = template_explanation(facts, "知觉速度怎么算的")
    assert "None" not in text and "null" not in text
    assert "编码答对 12 题" in text and "分类答对 9 题" in text
    assert "限时 45 秒" in text


def test_partial_metrics_never_render_none_or_empty_clauses():
    facts = {
        "vc": {"correct": 5},
        "ps": {"seconds": None, "trials": None, "correct": 14},
        "sv": {"total": None},
        "am": {"hits": 4},
        "nc": {},
    }
    text = template_explanation(facts, "这次怎么样")
    assert "None" not in text, text
    assert "null" not in text
    for bad in ("、、", "；；", "：、", "：；", "：\n· \n", "题、\n"):
        assert bad not in text, (bad, text)
    # 每一行"· 维度：…"冒号后面必须有内容（空子句就是旧版 None 的另一副面孔）
    for line in text.splitlines():
        if line.startswith("· ") and "：" in line:
            assert line.split("：", 1)[1].strip(), line
    assert "知觉速度" in text and "联想记忆" in text
    assert "空间视觉化" not in text  # 只有 sv: {total: None} → 整行跳过


def test_report_template_is_none_free_too():
    """报告兜底（template_narrative）与对话兜底同源，旧版同样在拼 seconds/trials。"""
    facts = {
        "vc": {"total": 8, "correct": 6},
        "ps": {"encCorrect": 10, "encWrong": 1, "catCorrect": 8, "catWrong": 2, "seconds": 45},
        "sv": {"total": 8},
        "am": {"hits": 5, "falseAlarms": 1},
    }
    text = template_narrative(facts)
    assert "None" not in text, text
    assert "知觉速度" in text and "编码答对 10 题" in text


def test_empty_facts_says_so():
    assert "没有可解读的原始指标" in template_explanation({}, "你好")
    assert "没有可解读的原始指标" in template_explanation(None, "")


# ---------------------------------------------------------------------------
# 根因 3 的下半段：兜底要针对 intent 给有用内容，不是指标 dump
# ---------------------------------------------------------------------------

def test_advice_question_gets_advice_not_a_metrics_dump(monkeypatch):
    facts = {
        "vc": {"total": 8, "correct": 6, "score": 62},
        "ps": {
            "encCorrect": 12,
            "encWrong": 3,
            "catCorrect": 9,
            "catWrong": 2,
            "seconds": 45,
            "score": 71,
        },
        "am": {"hits": 4, "falseAlarms": 3, "score": 26},
    }
    result = run_template(monkeypatch, "我明天建议测什么", facts)
    assert result["source"] == "template"
    text = result["text"]
    assert "None" not in text
    assert "下一步" in text, text
    assert "可以" in text and ("间隔" in text or "复测" in text), text
    # 最低分的维度必须被点名（弱项来自 facts，不来自猜测）
    assert "联想记忆" in text


def test_dimension_question_gets_that_dimension(monkeypatch):
    facts = {
        "vc": {"total": 8, "correct": 6, "score": 62},
        "am": {"hits": 4, "falseAlarms": 3, "score": 26},
    }
    text = run_template(monkeypatch, "为什么联想记忆低", facts)["text"]
    assert "联想记忆" in text
    assert "言语理解" not in text  # 只答用户问的那一项，不再全表 dump
    assert "怎么读" in text


def test_practice_question_gets_practice_advice(monkeypatch):
    facts = {
        "vc": {"total": 8, "correct": 6, "score": 62},
        "am": {"hits": 4, "falseAlarms": 3, "score": 26},
    }
    text = run_template(monkeypatch, "联想记忆怎么练", facts)["text"]
    assert "下一步" in text and "可以" in text
    assert "言语理解" not in text


def test_advice_line_is_cited_only_when_the_chunk_was_retrieved(monkeypatch):
    facts = {"am": {"hits": 4, "falseAlarms": 3, "score": 26}}
    with_kb = run_template(monkeypatch, "联想记忆怎么练", facts, chunks=[
        {"id": "kb-dim-am-01", "title": "联想记忆怎么练", "text": "按场景分组。"}
    ])["text"]
    without_kb = run_template(monkeypatch, "联想记忆怎么练", facts, chunks=[])["text"]
    assert "引用：kb-dim-am-01" in with_kb
    assert "引用" not in without_kb


def test_version_number_is_not_a_metric_but_91_still_is():
    """(a) 修根因：`scoring-v3.3` 里的 3.3 是口径标识，不是本次指标数字。

    曾经校验器把它当成"facts 里没有的数字"判死 —— 模型只要复述计分版本就被回退模板。
    反过来，凭空出现的 91 依然必须拦：这条豁免只认"紧跟字母/连字符的点分号"。
    """
    from app.scoring import SCORING_VERSION

    assert SCORING_VERSION == "scoring-v3.3"
    quoted = validate_text(
        f"分数不在这里给，服务端按 {SCORING_VERSION} 折算，与本次题目难度无关。仅供参考。",
        allowed_numbers=set(),
        policy=policy_for("chat_explain"),
    )
    assert quoted["ok"], quoted["issues"]

    invented = validate_text(
        "你的正确率是 91%。仅供参考。", allowed_numbers=set(), policy=policy_for("chat_explain")
    )
    assert not invented["ok"]
    assert any(issue["code"] == "unsourced_number" for issue in invented["issues"])

    # 正常写成小数秒的指标仍然照常校验（前面是空格，不是字母）
    seconds_ok = validate_text(
        "平均每次作答约 2.5 秒。仅供参考。",
        allowed_numbers={2.5},
        policy=policy_for("chat_explain"),
    )
    assert seconds_ok["ok"], seconds_ok["issues"]
    seconds_bad = validate_text(
        "平均每次作答约 2.5 秒。仅供参考。", allowed_numbers=set(), policy=policy_for("chat_explain")
    )
    assert not seconds_bad["ok"]


def test_chat_fallback_wording_does_not_leak_the_version_string():
    """(b) 用户文案干净：对话兜底不再报版本号，版本走 API 字段 scoringVersion。"""
    facts = {"am": {"hits": 4, "falseAlarms": 3, "score": 26}}
    text = template_explanation(facts, "联想记忆为什么低")
    assert "scoring-v" not in text
    assert "分数" in text  # 仍然告诉用户分数不在这里给


# ---------------------------------------------------------------------------
# 记忆沉淀的纯函数口径（不连库；库侧行为见 test_memory_sediment.py）
# ---------------------------------------------------------------------------

def test_advice_extraction_takes_suggestion_lines_not_metric_lines():
    from app.agent.insights import advice_from_reply

    reply = (
        "下一步可以这样安排：\n"
        "· 知觉速度 · 需要快速判断时先把准确放在速度前面。\n"
        "· 想看到可比的变化，请隔一周以上再复测同一档位。\n"
        "\n"
        "这次相关维度的原始数字是：\n"
        "· 知觉速度：限时 45 秒；编码答对 12 题、答错 2 题\n"
        "\n"
        "这些只是本次测得的原始数据，不是分数，也不与人群比较。"
    )
    items = advice_from_reply(reply, [])
    assert len(items) == 2
    titles = [item["title"] for item in items]
    assert all("限时" not in title and "编码答对" not in title for title in titles), titles
    assert all(item["id"] and len(item["title"]) <= 56 for item in items)
    # 同一句话换一种前缀，归一化键必须相同（否则建议表会被同一句话刷屏）
    assert items[0]["key"] == advice_from_reply(
        "可以试试：\n· 需要快速判断时先把准确放在速度前面。", []
    )[0]["key"]


def test_profile_signal_only_accepts_explicit_statements():
    from app.agent.insights import profile_signal

    assert profile_signal("我的目标是通过体测") == {"goal": "通过体测"}
    assert profile_signal("我每天只有十分钟")["constraint"]
    assert profile_signal("我习惯晚上练")["preference"]
    # 提问不是目标
    assert profile_signal("我想问下知觉速度是什么") == {}
    assert profile_signal("为什么联想记忆低？") == {}


def test_summary_text_never_invents_numbers_or_prints_none():
    from app.agent.insights import summary_text

    with_scores = summary_text(
        topic="联想记忆", tier="standard", lowest=("am", 26), advice_count=2
    )
    assert "None" not in with_scores and "联想记忆" in with_scores and "26" in with_scores
    without_scores = summary_text(
        topic="这次测评的结果", tier="quick", lowest=(None, None), advice_count=0
    )
    assert "None" not in without_scores
    assert "最低" not in without_scores  # 没有参考分就不写这一句
    assert "0" in without_scores  # 建议数是我们自己数的，可以为 0


def test_template_chat_explain_is_direct_answer_first():
    """对话兜底第一句要回应问题本身，不是"本次完成的原始指标："。"""
    facts = {
        "am": {"hits": 4, "falseAlarms": 3, "score": 26},
        "vc": {"total": 8, "correct": 6, "score": 62},
    }
    text = template_explanation(facts, "为什么联想记忆低？")
    first_line = text.splitlines()[0]
    assert first_line.startswith("你问的是联想记忆"), first_line
    assert "本次完成的原始指标：" not in text


def test_fallback_templates_stay_clean_of_banned_wording():
    """模板自身也要过口径：兜底文案如果命中禁用词，就是产品自己在踩红线。"""
    facts = {
        "vc": {"total": 8, "correct": 2, "score": 12},
        "ps": {
            "encCorrect": 2,
            "encWrong": 9,
            "catCorrect": 1,
            "catWrong": 8,
            "seconds": 45,
            "score": 9,
        },
        "sv": {"total": 8, "correct": 3, "score": 20},
        "am": {"hits": 1, "falseAlarms": 7, "score": 5},
    }
    for question in ("这次怎么样", "我明天建议测什么", "联想记忆为什么低", "知觉速度怎么练"):
        text = template_explanation(facts, question)
        verdict = validate_text(
            text,
            allowed_numbers=derived_allowed_numbers(facts),
            policy=policy_for("chat_explain"),
            score_owners=dimension_score_owners(facts),
        )
        hard = [issue for issue in verdict["issues"] if issue["severity"] == "hard"]
        assert not hard, (question, hard, text)


# ---------------------------------------------------------------------------
# 根因 5：寒暄是"没有别的信号时的收尾"，不是硬路由
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "question,expected",
    [
        ("你好", "greeting"),
        ("在吗", "greeting"),
        ("你好呀", "greeting"),
        ("你好，我的认知怎么样", "summary"),
        ("HI，我的认知怎么样", "summary"),
        ("你好，我想提分", "clarify"),
        ("hello，我接下来该练什么？", "advice"),
        ("如何提高编程能力？", "explain"),
        ("我是不是得了抑郁症", "boundary"),
        ("我不想活了", "crisis"),
        ("这两次测评有什么变化", "trend"),
        ("我就是笨，什么都记不住", "self_blame"),
    ],
)
def test_greeting_no_longer_swallows_questions_with_content(question, expected):
    verdict = classify(question)
    assert verdict["intent"] == expected, verdict


def test_greeting_without_assessment_states_the_boundary():
    """没有测评分时，"你好"不能把用户引向一个根本答不出来的问题。"""
    result = answer(None, "你好", {}, [], None)
    assert result["intent"] == "greeting"
    assert "先完成一次测评" in result["text"], result["text"]


def test_greeting_with_results_offers_real_questions():
    result = answer(None, "你好", {"am": {"hits": 4, "falseAlarms": 3}}, [], None)
    assert result["intent"] == "greeting"
    assert "先完成一次测评" not in result["text"]
    assert "我的认知怎么样" in result["text"]


# ---------- 第 3 轮实测：免责用法误伤 + 强项问题路由 ----------


def test_disclaimer_use_of_clinical_words_is_not_a_violation():
    """模型写「这不是诊断结论」曾被裸词表判 hard，正确的趋势回答退成模板。

    而系统自己补写的固定声明（`SCOPE_BACKFILL`）含同一个"诊断"却合法 ——
    等于只许官方免责、不许模型免责。现在两边同一套规则。
    """
    allowed = [
        "这不是诊断结论，只是本次任务的原始表现。仅供参考。",
        "以上不代表任何疾病或障碍的判断，不与人群比较。仅供参考。",
        "我们不能给出治疗建议，也不做诊断。仅供参考。",
        "分数不用于判断任何疾病，也不与人群比较。仅供参考。",
    ]
    for sentence in allowed:
        assert not A.banned_word_hits(sentence, policy_for("chat_explain")), sentence

    blocked = [
        "这次结果可以诊断出注意力问题。仅供参考。",
        "建议你接受治疗来改善表现。仅供参考。",
        "这属于轻度抑郁的表现。仅供参考。",
        "你的表现符合某种障碍。仅供参考。",
    ]
    for sentence in blocked:
        assert A.banned_word_hits(sentence, policy_for("chat_explain")), sentence


def test_banned_negation_window_is_near_the_hit():
    """否定线索只在命中词附近才算，不能被远处一个"不"字洗白。"""
    far = "我们不做任何承诺。另外这次结果可以诊断出注意力问题。仅供参考。"
    assert "诊断" in A.banned_word_hits(far, policy_for("chat_explain"))


def test_strength_questions_are_routed_to_summary():
    """「我哪方面比较强」曾被强词「比较」吃掉路由到趋势，答非所问。"""
    from importlib import import_module

    words = import_module("app.agent.classify")
    assert "比较" not in words.TREND_STRONG_WORDS
    for question in ("我有什么优点", "我哪方面比较强", "我擅长什么", "我有什么不足"):
        assert A.classify(question)["intent"] == A.INTENT["SUMMARY"], question
    # 有趋势语境时仍然趋势优先
    assert A.classify("这两次哪项比较强")["intent"] == A.INTENT["TREND"]


def test_summary_prompt_teaches_non_rating_phrasing():
    """提示词必须教模型怎么回答强项问题，否则它写「表现最好」被自己的红线拦掉。"""
    prompt = prompt_for("summary")
    assert "相对较高" in prompt
    assert "表现最好" in prompt  # 明确点名这个写法会被判死
