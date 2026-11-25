"""本地 RAG：有 embedding 模型时用 pgvector，否则回退 BM25。"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from ..config import settings
from ..models import KBChunk
from .base import Retriever, ScoredChunk, rrf
from .bm25 import Bm25Retriever, bm25_rank, tokenize
from .vector import (
    EMBEDDING_MODEL,
    MIN_VECTOR_ONLY_SCORE,
    VectorRetriever,
    get_model,
    vector_search,
)

__all__ = [
    "Retriever",
    "ScoredChunk",
    "Bm25Retriever",
    "VectorRetriever",
    "bm25_rank",
    "tokenize",
    "retrieve",
    "warmup",
    "content_hash",
    "ingest_embeddings",
    "rag_status",
]


def retrieve(db: Session, query: str, limit: int = 3) -> list[ScoredChunk]:
    query = str(query or "").strip()
    if not query:
        return []
    lexical = Bm25Retriever().retrieve(db, query, max(limit, 20))
    if (settings.rag_mode or "auto").lower() == "keyword":
        return lexical[:limit]
    semantic = vector_search(db, query, max(limit, 20))
    if not semantic and not lexical:
        return []
    if not semantic:
        return lexical[:limit]
    if not lexical:
        return semantic[:limit] if semantic[0]["score"] >= MIN_VECTOR_ONLY_SCORE else []
    return rrf(semantic, lexical, limit=limit)


def warmup() -> None:
    """在第一个用户问题之前加载可选的 embedding 模型。"""
    get_model()


def content_hash(chunk: dict) -> str:
    payload = "\n".join(
        [
            str(chunk.get("title", "")),
            str(chunk.get("text", "")),
            " ".join(chunk.get("tags") or []),
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def ingest_embeddings(db: Session, force: bool = False) -> int:
    """本地模型可用时为已审知识块生成向量，返回更新条数。"""
    model = get_model()
    if model is None:
        return 0
    chunks = list(db.scalars(select(KBChunk).where(KBChunk.review_status == "reviewed")).all())
    pending = [
        chunk
        for chunk in chunks
        if force or chunk.embedding is None or chunk.embedding_model != EMBEDDING_MODEL
    ]
    if not pending:
        return 0
    vectors = list(model.embed([f"{c.title}\n{c.text}" for c in pending]))
    now = datetime.now(timezone.utc)
    for chunk, vector in zip(pending, vectors, strict=False):
        chunk.embedding = [float(v) for v in vector]
        chunk.embedding_model = EMBEDDING_MODEL
        chunk.embedded_at = now
        chunk.content_hash = content_hash(
            {"title": chunk.title, "text": chunk.text, "tags": chunk.tags}
        )
    db.commit()
    return len(pending)


def rag_status(db: Session) -> dict:
    total = db.scalar(select(text("count(*)")).select_from(KBChunk)) or 0
    embedded = (
        db.scalar(
            select(text("count(*)")).select_from(KBChunk).where(KBChunk.embedding.is_not(None))
        )
        or 0
    )
    return {
        "chunks": int(total),
        "embedded": int(embedded),
        "mode": "vector" if embedded and get_model() is not None else "keyword",
        "model": EMBEDDING_MODEL,
    }
