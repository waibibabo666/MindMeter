"""面向用户的呈现：把「知识库编号」换成人话，并只展示真正被引用的来源。

两个实测问题（人工测试图 05）：
1. 回答正文里出现 `引用：kb-dim-ni-01 · 自然知识测什么`，用户不知道 kb-… 是什么；
2. 回答讲的是言语理解、归纳推理、知觉速度，来源却挂了检索到的全部 8 个知识块，
   其中有「自然知识测什么」——**检索到不等于用到了**。

做法：服务端内部仍用编号校验与沉淀记忆（`text` 不动），
返回给用户的 `displayText` 去掉所有编号，`shownSources` 只留正文里真的写到的知识块。
"""
from __future__ import annotations

import re

# 整行的引用/参考行；行内括号尾巴；残留的裸编号（可选带「 · 标题」）。
_CITATION_LINE_RE = re.compile(r"^[ \t]*(?:引用|参考)[ \t]*[:：].*$", re.MULTILINE)
_CITATION_TAIL_RE = re.compile(r"[（(]\s*(?:引用|参考)\s*[:：][^)）]*[)）]")
_KB_ID = r"[Kk][Bb]-[A-Za-z0-9\-_]+"
_KB_ID_RE = re.compile(_KB_ID)
_BARE_ID_RE = re.compile(_KB_ID + r"(?:[ \t]*[·・][ \t]*[^\s，。；：:）)、]+)?")


def _by_id(sources: list | None) -> dict[str, dict]:
    return {
        str(item.get("id") or "").lower(): item
        for item in (sources or [])
        if isinstance(item, dict) and item.get("id")
    }


def cited_sources(text: str, sources: list | None) -> list[dict]:
    """正文里实际写到的知识块（按首次出现的顺序），不在检索结果里的编号一律不认。"""
    known = _by_id(sources)
    seen: list[dict] = []
    for match in _KB_ID_RE.findall(str(text or "")):
        item = known.get(match.lower())
        if item is not None and item not in seen:
            seen.append(item)
    return seen


def display_text(text: str, sources: list | None) -> str:
    """去掉引用行与括号引用；正文里残留的编号换成知识块标题（认不出就删掉）。"""
    known = _by_id(sources)
    value = _CITATION_LINE_RE.sub("", str(text or ""))
    value = _CITATION_TAIL_RE.sub("", value)

    def humanize(match: re.Match) -> str:
        id_match = _KB_ID_RE.match(match.group(0))
        item = known.get(id_match.group(0).lower()) if id_match else None
        title = str((item or {}).get("title") or "").strip()
        return f"「{title}」" if title else ""

    value = _BARE_ID_RE.sub(humanize, value)
    value = re.sub(r"[ \t]+\n", "\n", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()
