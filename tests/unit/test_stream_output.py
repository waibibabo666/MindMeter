"""流式输出（2026-11-21）：把最终回答切块下发，前端做打字机效果。

默认关闭（`MM_*` 无关，由前端偏好 `streamReply` 控制），所以不会影响既有对话流程。
"""
from __future__ import annotations

from app.api.chat import _iter_text_chunks


def test_chunks_cover_whole_text():
    text = "联想记忆这一项再认命中 4 个，虚报 3 个。"
    chunks = list(_iter_text_chunks(text, 6))
    assert "".join(chunks) == text
    assert all(0 < len(chunk) <= 6 for chunk in chunks)


def test_chunks_handle_short_and_empty_text():
    assert list(_iter_text_chunks("", 6)) == []
    assert list(_iter_text_chunks("短", 6)) == ["短"]
