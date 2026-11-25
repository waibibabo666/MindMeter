"""Semantic retrieval over pgvector, with a local embedding model.

Optional: when ``fastembed``/model files are unavailable, every call returns
an empty list and the caller falls back to BM25. We never fabricate vectors.
"""
from __future__ import annotations

import os
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import settings
from .base import ScoredChunk

EMBEDDING_MODEL = "BAAI/bge-small-zh-v1.5"
MIN_VECTOR_SCORE = 0.45
MIN_VECTOR_ONLY_SCORE = 0.6

_model = None
_model_failed = False


def prepare_embedding_env() -> None:
    cache = Path(settings.data_dir) / "models"
    cache.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("FASTEMBED_CACHE_PATH", str(cache))
    # httpx 0.28 cannot parse bracketed IPv6 entries in NO_PROXY.
    for name in ("NO_PROXY", "no_proxy"):
        value = os.environ.get(name, "")
        if value:
            os.environ[name] = ",".join(
                part for part in value.split(",") if part.strip() not in {"[::1]", "::1"}
            )


def get_model():
    """Load the embedding model once; ``None`` means "not available here"."""
    global _model, _model_failed
    if _model is not None or _model_failed:
        return _model
    prepare_embedding_env()
    try:
        from fastembed import TextEmbedding

        _model = TextEmbedding(model_name=EMBEDDING_MODEL)
    except Exception:
        _model_failed = True
        _model = None
    return _model


def vector_search(db: Session, query: str, limit: int) -> list[ScoredChunk]:
    model = get_model()
    if model is None:
        return []
    try:
        vector = list(next(iter(model.embed([query]))))
    except Exception:
        return []

    sql = text(
        """
        SELECT id, title, text, source, 1 - (embedding <=> CAST(:q AS vector)) AS score
        FROM kb_chunks
        WHERE review_status = 'reviewed' AND embedding IS NOT NULL
        ORDER BY embedding <=> CAST(:q AS vector)
        LIMIT :limit
        """
    )
    rows = db.execute(
        sql,
        {"q": "[" + ",".join(f"{float(v):.8f}" for v in vector) + "]", "limit": max(limit, 20)},
    ).all()
    return [
        {
            "id": row.id,
            "title": row.title,
            "text": row.text,
            "source": row.source or {},
            "score": float(row.score or 0),
        }
        for row in rows
        if float(row.score or 0) >= MIN_VECTOR_SCORE
    ]


class VectorRetriever:
    name = "vector"

    def retrieve(self, db: Session, query: str, limit: int) -> list[ScoredChunk]:
        return vector_search(db, query, limit)
