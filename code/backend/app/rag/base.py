"""检索器契约：词法（BM25）与语义（向量）共用。"""
from __future__ import annotations

from typing import Protocol, TypedDict

from sqlalchemy.orm import Session


class ScoredChunk(TypedDict):
    id: str
    title: str
    text: str
    source: dict
    score: float


class Retriever(Protocol):
    """对已审知识块做排序的检索后端。"""

    name: str

    def retrieve(self, db: Session, query: str, limit: int) -> list[ScoredChunk]: ...


def rrf(*rankings: list[ScoredChunk], limit: int) -> list[ScoredChunk]:
    """多路排序的倒数排名融合（无需分数校准）。"""
    scores: dict[str, float] = {}
    items: dict[str, ScoredChunk] = {}
    for ranking in rankings:
        for rank, item in enumerate(ranking, 1):
            items.setdefault(item["id"], item)
            scores[item["id"]] = scores.get(item["id"], 0.0) + 1.0 / (60 + rank)
    ordered = sorted(scores.items(), key=lambda pair: pair[1], reverse=True)
    out: list[ScoredChunk] = []
    for chunk_id, score in ordered[:limit]:
        item = dict(items[chunk_id])
        item["score"] = round(score, 6)
        out.append(item)
    return out
