"""词法回退：基于字符 bigram 的 BM25。"""
from __future__ import annotations

import math
import re
from collections import Counter

from ..models import KBChunk
from .base import ScoredChunk

BM25_K1 = 1.2
BM25_B = 0.75
MIN_BM25_SCORE = 2.5

NOISE = set("的了是 吗呢啊我你会 有在和与就都".replace(" ", ""))
QUERY_STOP_PHRASES = (
    "为什么",
    "怎么",
    "如何",
    "怎样",
    "提高",
    "提升",
    "建议",
    "练习",
    "解释",
    "原因",
    "哪项",
    "哪一项",
    "什么意思",
    "怎么看",
    "一下",
    "可以",
    "是否",
)


def query_text(value: str) -> str:
    text = str(value or "")
    for phrase in QUERY_STOP_PHRASES:
        text = text.replace(phrase, " ")
    return text


def tokenize(value: str) -> list[str]:
    src = str(value or "").lower()
    tokens = re.findall(r"[a-z0-9]+", src)
    zh = re.sub(r"[^\u4e00-\u9fa5]", "", src)
    if len(zh) == 1:
        tokens.append(zh)
    else:
        for i in range(len(zh) - 1):
            gram = zh[i : i + 2]
            if gram not in NOISE:
                tokens.append(gram)
    return tokens


def chunk_text(chunk: KBChunk) -> str:
    return " ".join([chunk.title, chunk.text, " ".join(chunk.tags or [])])


def bm25_rank(rows: list[KBChunk], query: str, limit: int) -> list[ScoredChunk]:
    docs: list[tuple[KBChunk, Counter[str], int]] = []
    df: Counter[str] = Counter()
    total_len = 0
    for chunk in rows:
        tokens = tokenize(chunk_text(chunk))
        tf = Counter(tokens)
        df.update(tf.keys())
        total_len += len(tokens)
        docs.append((chunk, tf, len(tokens)))
    if not docs:
        return []
    avgdl = total_len / len(docs)
    terms = list(dict.fromkeys(tokenize(query_text(query))))
    if not terms:
        return []

    def idf(token: str) -> float:
        n = df.get(token, 0)
        return math.log(1 + (len(docs) - n + 0.5) / (n + 0.5))

    scored: list[ScoredChunk] = []
    for chunk, tf, length in docs:
        score = 0.0
        matched = 0
        for term in terms:
            freq = tf.get(term, 0)
            if not freq:
                continue
            matched += 1
            denom = freq + BM25_K1 * (1 - BM25_B + BM25_B * length / (avgdl or 1))
            score += idf(term) * (freq * (BM25_K1 + 1) / denom)
        # One common term (e.g. "能力") is not enough evidence; a single rare
        # term (e.g. "睡眠") can still be a strong hit.
        if matched == 0:
            continue
        if matched < 2 and score < MIN_BM25_SCORE:
            continue
        scored.append(
            {
                "id": chunk.id,
                "title": chunk.title,
                "text": chunk.text,
                "source": chunk.source or {},
                "score": round(score, 6),
            }
        )
    scored.sort(key=lambda item: item["score"], reverse=True)
    return scored[:limit]


class Bm25Retriever:
    name = "keyword"

    def retrieve(self, db, query: str, limit: int) -> list[ScoredChunk]:
        from sqlalchemy import select

        rows = list(
            db.scalars(
                select(KBChunk)
                .where(KBChunk.review_status == "reviewed")
                .order_by(KBChunk.id)
            ).all()
        )
        return bm25_rank(rows, query, limit)
