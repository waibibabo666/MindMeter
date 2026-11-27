"""用户可见文本：不出现知识库编号，来源只含正文真的用到的知识块（人工测试图 05）。"""
from app.agent.display import cited_sources, display_text

SOURCES = [
    {"id": "kb-dim-ps-02", "title": "知觉速度怎么读", "text": "…"},
    {"id": "kb-dim-ni-01", "title": "自然知识测什么", "text": "…"},
    {"id": "kb-dim-vc-01", "title": "言语理解测什么", "text": "…"},
]


def test_citation_line_is_removed_even_when_scope_note_follows_it():
    text = (
        "言语理解全对。\n\n引用：kb-dim-vc-01 · 言语理解测什么\n\n"
        "以上只反映本次任务的原始表现，不是常模。"
    )
    shown = display_text(text, SOURCES)
    assert "kb-" not in shown and "引用" not in shown
    assert "以上只反映本次任务" in shown and "言语理解全对" in shown


def test_inline_parenthesis_citation_is_removed():
    shown = display_text("先把准确放在速度前面（引用：kb-dim-ps-02）。", SOURCES)
    assert shown == "先把准确放在速度前面。"


def test_bare_id_in_prose_becomes_the_chunk_title():
    shown = display_text("依据 kb-dim-vc-01 · 言语理解测什么 的说明，这项看词义。", SOURCES)
    assert "kb-" not in shown and "「言语理解测什么」" in shown


def test_only_sources_actually_cited_are_shown():
    text = "言语理解全对。\n引用：kb-dim-vc-01 · 言语理解测什么"
    shown = cited_sources(text, SOURCES)
    assert [item["id"] for item in shown] == ["kb-dim-vc-01"]  # 检索到的另外两块没用到


def test_unknown_ids_are_not_treated_as_sources():
    assert cited_sources("引用：kb-zz-99 · 不存在", SOURCES) == []


def test_no_citation_means_no_sources_instead_of_guessing():
    assert cited_sources("言语理解全对。", SOURCES) == []
