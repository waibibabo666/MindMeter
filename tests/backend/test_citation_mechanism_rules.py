"""引用行占位符与机制归因两条新规则（2026-11-20 真实模型复跑发现的第 2、3 个问题）。

问题 2：`policies.BASE_PROMPT` 原来写「回答末尾另起一行写「引用：知识块编号 · 标题」」，
真实模型把说明文字当字面内容抄进回答，实测原话：
    引用：知识块编号 · 标题
    引用：知识块编号 · 标题 / kb-dim-am-
修法：提示词给出**本轮真实编号**（`build_messages` 直接注入 `引用：<真实编号> · <真实标题>` 清单），
校验侧引用行必须命中一个真实存在的 kb id（否则 soft `citation_missing`），
出现占位字样单独记 soft `citation_placeholder`。**两条都不升级为 hard**，不做回退。

问题 3：模型给指标编造认知机制，实测原话：
    这表明在回忆配对关系时，可能存在一定的混淆或回忆效率有待提升
    有1次是符号类别错误（属于目标符号本身错误），2次是符号编码错误（属于选项比对阶段失误）
修法：`mechanism_hits` 只认「机制名词 + 归因动词」同句共现与 `属于…错误/失误`，
命中 hard → 回退模板；同时提示词明确禁止。三句正常话术必须放行（下面的 whitelist 测试）。
"""
from __future__ import annotations

from types import SimpleNamespace

from app import agent as A
from app.agent import (
    answer,
    build_messages,
    mechanism_hits,
    validate_text,
)
from app.agent.policies import CITATION_PLACEHOLDERS, policy_for, prompt_for
from app.llm import LLMConfig, LLMReply

FACTS = {
    "vc": {"total": 8, "correct": 5, "meanRtMs": 2500, "score": 50},
    "ps": {
        "encCorrect": 12, "encWrong": 2, "catCorrect": 9, "catWrong": 3,
        "meanRtMs": 1880, "seconds": 45, "score": 71,
    },
    "am": {"hits": 4, "falseAlarms": 3, "targets": 8, "firstTry": 3, "meanRtMs": 1870, "score": 26},
}
CHUNKS = [
    {"id": "kb-dim-am-01", "title": "联想记忆测什么", "text": "词对配对与再认判断。"},
    {"id": "kb-plan-01", "title": "日常可以怎么做", "text": "把练习分散到不同日子。"},
]


def run_graph(monkeypatch, question, reply_text, chunks=CHUNKS, facts=None, scene="chat_explain"):
    class FakeDb:
        def scalar(self, _stmt):
            return None

        def scalars(self, _stmt):
            return SimpleNamespace(all=lambda: list(chunks))

    monkeypatch.setattr(A, "retrieve_kb", lambda db, query, limit=3: list(chunks))
    monkeypatch.setattr(A, "call_llm_with_fallback", lambda config, messages, **kw: LLMReply(text=reply_text, model="test-model"))
    monkeypatch.setattr(
        A, "site_llm_config",
        lambda: LLMConfig(endpoint="https://fake/v1", model="test-model", key="sk-test", enabled=True),
    )
    return answer(FakeDb(), question, facts or FACTS, [], None, scene=scene)


def check(text, scene="chat_explain", **kwargs):
    return validate_text(
        text,
        allowed_numbers=A.derived_allowed_numbers(FACTS),
        policy=policy_for(scene),
        score_owners=A.dimension_score_owners(FACTS),
        **kwargs,
    )


def codes(result):
    return {issue["code"] for issue in result["issues"]}


# ---------------------------------------------------------------------------
# 问题 2：提示词不再让模型抄占位符
# ---------------------------------------------------------------------------

def test_prompt_no_longer_uses_the_literal_placeholder():
    """提示词里不能出现「引用：知识块编号 · 标题」这种会被照抄的写法。"""
    for scene in ("chat_explain", "summary", "trend", "report"):
        prompt = prompt_for(scene)
        assert "引用：知识块编号 · 标题" not in prompt, scene
        assert "真实编号" in prompt, scene
        assert "知识块编号" in prompt  # 作为"禁止照抄"的反例出现，带在引号里
    from app.analysis import ANALYSIS_PROMPT

    assert "引用：知识块编号 · 标题" not in ANALYSIS_PROMPT
    assert "真实编号" in ANALYSIS_PROMPT


def test_prompt_forbids_mechanism_invention():
    prompt = prompt_for("chat_explain")
    for phrase in ("混淆", "回忆效率", "编码质量", "目标符号本身错误"):
        assert phrase in prompt, phrase  # 反例逐条写进提示词，模型才知道踩在哪
    from app.analysis import ANALYSIS_PROMPT

    assert "混淆" in ANALYSIS_PROMPT


def test_citation_ids_are_injected_into_the_user_block():
    """本轮检索到的真实编号与标题直接进指令，模型不需要猜格式。"""
    block = build_messages("联想记忆怎么练", FACTS, CHUNKS, [], None)[-1]["content"]
    assert "引用：kb-dim-am-01 · 联想记忆测什么" in block, block
    assert "引用：kb-plan-01 · 日常可以怎么做" in block, block
    # 没有知识块时不写这句（否则模型会抄一个空清单）
    empty = build_messages("联想记忆怎么练", FACTS, [], [], None)[-1]["content"]
    assert "引用行请照抄" not in empty, empty


def test_analysis_messages_also_get_the_real_ids():
    from app.analysis import build_messages as analysis_build

    block = analysis_build(FACTS, CHUNKS, "我的认知怎么样")[-1]["content"]
    assert "引用：kb-dim-am-01 · 联想记忆测什么" in block, block


# ---------------------------------------------------------------------------
# 问题 2：校验侧 citation_placeholder / citation_missing（都是 soft）
# ---------------------------------------------------------------------------

def test_placeholder_citation_is_a_soft_citation_placeholder():
    text = (
        "联想记忆首次配对成功 3/8 组，再认命中 4 个、虚报 3 个。这些数字只反映本次任务。"
        "引用：知识块编号 · 标题"
    )
    result = check(text, chunk_ids=[chunk["id"] for chunk in CHUNKS])
    assert result["ok"], result["issues"]  # soft：不回退
    assert "citation_placeholder" in codes(result), result["issues"]
    assert "citation_missing" not in codes(result), result["issues"]


def test_truncated_placeholder_is_caught_too():
    result = check(
        "命中 4 个、虚报 3 个。仅供参考。引用：知识块编号 · 标题 / kb-dim-am-",
        chunk_ids=[chunk["id"] for chunk in CHUNKS],
    )
    assert "citation_placeholder" in codes(result), result["issues"]


def test_citation_line_must_contain_a_real_kb_id():
    """引用行里的编号必须是本轮真的检索到的（soft，不升级为 hard）。"""
    text = "命中 4 个、虚报 3 个。仅供参考。引用：kb-dim-zz-99 · 不存在的块"
    result = check(text, chunk_ids=[chunk["id"] for chunk in CHUNKS])
    assert result["ok"]
    assert "citation_missing" in codes(result), result["issues"]

    good = check("命中 4 个、虚报 3 个。仅供参考。引用：kb-plan-01 · 日常可以怎么做",
                 chunk_ids=[chunk["id"] for chunk in CHUNKS])
    assert codes(good) <= {"scope_note_missing"}, good["issues"]  # 引用这条不再被记

    missing_line = check("命中 4 个、虚报 3 个。仅供参考。", chunk_ids=[chunk["id"] for chunk in CHUNKS])
    assert "citation_missing" in codes(missing_line), missing_line["issues"]


def test_placeholder_table_is_shared_by_prompt_and_validator():
    assert CITATION_PLACEHOLDERS and all(word in prompt_for("chat_explain") for word in CITATION_PLACEHOLDERS[:1])


def test_placeholder_answer_is_not_replaced_by_template(monkeypatch):
    """soft 就真的是 soft：模型答得对但引用行抄了占位符，用户仍然看到模型的回答。"""
    reply = (
        "联想记忆首次配对成功 3/8 组，再认命中 4 个、虚报 3 个，平均每次作答 1.87 秒。"
        "这些数字只反映本次任务。建议把练习分散到不同日子。"
        "引用：知识块编号 · 标题"
    )
    result = run_graph(monkeypatch, "为什么联想记忆低？", reply)
    assert result["source"] == "llm", result
    assert result["code"] == "citation_placeholder", result
    assert any(issue["code"] == "citation_placeholder" for issue in result["validation"])


# ---------------------------------------------------------------------------
# 问题 3：机制归因 = hard，回退模板
# ---------------------------------------------------------------------------

MODEL_MECHANISM_AM = (
    "联想记忆首次配对成功 3/8 组，再认命中 4 个、虚报 3 个，平均每次作答 1.87 秒。"
    "这表明在回忆配对关系时，可能存在一定的混淆或回忆效率有待提升。"
    "这些数字只反映本次任务，不是常模，也不与人群比较。"
)
MODEL_MECHANISM_PS = (
    "知觉速度编码答对 12 题、答错 2 题，分类答对 9 题、答错 3 题。"
    "有1次是符号类别错误（属于目标符号本身错误），2次是符号编码错误（属于选项比对阶段失误）。"
    "这些数字只反映本次任务，不是常模，也不与人群比较。"
)


def test_mechanism_sentences_are_hard_blocked():
    for text in (MODEL_MECHANISM_AM, MODEL_MECHANISM_PS):
        result = check(text)
        assert not result["ok"], (text, result["issues"])
        assert "mechanism_speculation" in codes(result), result["issues"]
        assert all(
            issue["severity"] == "hard" for issue in result["issues"] if issue["code"] == "mechanism_speculation"
        )


def test_mechanism_falls_back_to_template(monkeypatch):
    result = run_graph(monkeypatch, "为什么联想记忆低？", MODEL_MECHANISM_AM)
    assert result["source"] == "template", result
    assert result["code"] == "mechanism_speculation", result
    assert "混淆" not in result["text"] and "回忆效率" not in result["text"]


def test_mechanism_hits_are_reported_verbatim_for_telemetry():
    hits = mechanism_hits(MODEL_MECHANISM_PS)
    assert any("属于" in hit and ("错误" in hit or "失误" in hit) for hit in hits), hits
    assert mechanism_hits(MODEL_MECHANISM_AM), mechanism_hits(MODEL_MECHANISM_AM)


def test_normal_task_condition_sentences_are_not_blocked():
    """窄规则：这三句（最后一句现有模板在用）必须放行。"""
    for text in (
        "睡眠不足会拉低速度类表现。仅供参考。",
        "间隔太短，练习效应会让差值不好解释。仅供参考。",
        "再认有时靠「眼熟」而不是真的记得，虚报多说明有几题被熟悉感带偏了。仅供参考。",
        "限时任务的结果同时反映速度与策略，要结合编码与分类两段的题量一起看。仅供参考。",
        "全程没有判断错误：限时任务要在快和准之间取舍，这次偏向了准。仅供参考。",
        "这些数字不能说明联想记忆能力的高低，也不与人群比较。仅供参考。",
        "单次结果说明不了能力高低，把它当作一次今天的快照更合适。仅供参考。",
        "符号表里的图形长得相近，容易混淆是题目形式的一部分。仅供参考。",
        "这次作答依赖的是学习阶段的编码质量，这里没有对应读数。仅供参考。",
    ):
        result = check(text)
        assert "mechanism_speculation" not in codes(result), (text, result["issues"])


def test_templates_still_pass_the_new_hard_rule():
    """兜底模板自己也要过校验（否则产品自己在踩红线）。"""
    facts = {
        "vc": {"total": 8, "correct": 2, "score": 12},
        "ps": {"encCorrect": 2, "encWrong": 9, "catCorrect": 1, "catWrong": 8, "seconds": 45, "score": 9},
        "sv": {"total": 8, "correct": 3, "score": 20},
        "am": {"hits": 1, "falseAlarms": 7, "score": 5},
    }
    for question in ("这次怎么样", "我明天建议测什么", "联想记忆为什么低", "知觉速度怎么练", "空间视觉化怎么练"):
        text = A.template_explanation(facts, question)
        verdict = validate_text(
            text,
            allowed_numbers=A.derived_allowed_numbers(facts),
            policy=policy_for("chat_explain"),
            score_owners=A.dimension_score_owners(facts),
        )
        hard = [issue for issue in verdict["issues"] if issue["severity"] == "hard"]
        assert not hard, (question, hard, text)


def test_existing_red_lines_are_not_weakened():
    """红线：三层判定仍然在（数字、张冠李戴、评级词）。"""
    assert "unsourced_number" in codes(check("你的正确率是 91%。仅供参考。"))
    assert "score_misattributed" in codes(check("联想记忆得分 50，说明你只回忆出 5 组。仅供参考。"))
    assert "banned_word" in codes(check("联想记忆 1.87 秒，这表明在回忆速度上表现中等。仅供参考。"))
    assert policy_for("chat_explain")["max_chars"] == 360
    assert policy_for("chat_explain")["require_citation"] == "soft"
