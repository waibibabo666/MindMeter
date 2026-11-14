"""Local RAG: pgvector when an embedding model is available, BM25 otherwise.

The 30 reviewed chunks live in PostgreSQL. We never fabricate embeddings: if
fastembed/model files are unavailable, retrieval falls back to the same
character-bigram BM25 used by the frozen frontend.
"""
from __future__ import annotations

import hashlib
import math
import os
import re
import threading
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from ..config import settings
from ..models import KBChunk

BM25_K1 = 1.2
BM25_B = 0.75
EMBEDDING_MODEL = "BAAI/bge-small-zh-v1.5"
NOISE = set("的了是 吗呢啊我你会 有在和与就都".replace(" ", ""))
# 问句里的通用成分，几乎每条 chunk 都含，留着它们会让任何问题都"检索命中"。
QUESTION_STOP = {
    "为什",
    "什么",
    "怎么",
    "么样",
    "如何",
    "是不",
    "不是",
    "我的",
    "我们",
    "你们",
    "可以",
    "能否",
    "是否",
    "哪些",
    "这个",
    "那个",
    "时候",
    "现在",
    "一直",
    "总是",
    "感觉",
    "觉得",
    "知道",
    "告诉",
    "一下",
    "帮我",
}
# 命中率过低就不要硬凑引用：低于门槛按"知识库没有依据"处理。
RELATIVE_FLOOR = 0.32
VECTOR_MIN_SCORE = 0.35

_model = None
_model_failed = False
_model_holder: dict[str, object] = {}


def _prepare_embedding_env() -> None:
    cache = Path(settings.data_dir) / "models"
    cache.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("FASTEMBED_CACHE_PATH", str(cache))
    # httpx 0.28 cannot parse bracketed IPv6 entries in NO_PROXY.
    for name in ("NO_PROXY", "no_proxy"):
        value = os.environ.get(name, "")
        if value:
            cleaned = ",".join(
                part for part in value.split(",") if part.strip() not in {"[::1]", "::1"}
            )
            os.environ[name] = cleaned


def _load_model() -> None:
    from fastembed import TextEmbedding

    _model_holder["model"] = TextEmbedding(model_name=EMBEDDING_MODEL)


def _get_model():
    """Load the embedding model with a hard deadline.

    以前是同步加载：模型文件缺失时会联网下载，首个问答要等 40 s 甚至更久。
    现在超时就直接回退 BM25，后台线程失败也不影响回答。
    """
    global _model, _model_failed
    if _model is not None or _model_failed:
        return _model
    _prepare_embedding_env()
    timeout = float(getattr(settings, "rag_load_timeout_s", 6.0) or 6.0)
    worker = threading.Thread(target=_load_model, daemon=True)
    worker.start()
    worker.join(timeout)
    if worker.is_alive() or "model" not in _model_holder:
        _model_failed = True
        return None
    _model = _model_holder["model"]
    return _model


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


def _chunk_text(chunk: KBChunk) -> str:
    return " ".join([chunk.title, chunk.text, " ".join(chunk.tags or [])])


def _bm25(rows: list[KBChunk], query: str, limit: int) -> list[dict]:
    docs = []
    df: Counter[str] = Counter()
    total_len = 0
    for chunk in rows:
        tokens = tokenize(_chunk_text(chunk))
        tf = Counter(tokens)
        df.update(tf.keys())
        total_len += len(tokens)
        docs.append((chunk, tf, len(tokens)))
    if not docs:
        return []
    avgdl = total_len / len(docs)
    total = len(docs)
    raw_terms = list(dict.fromkeys(tokenize(query)))
    # 去掉"为什么/怎么/我的"这类通用成分和到处都出现的词，否则任何问题都能
    # 蹭到几条引用，"知识库没有依据"这个分支永远走不到。
    terms = [
        term
        for term in raw_terms
        if term not in QUESTION_STOP and df.get(term, 0) <= 0.5 * total
    ]
    if not terms:
        return []

    def idf(token: str) -> float:
        n = df.get(token, 0)
        return math.log(1 + (len(docs) - n + 0.5) / (n + 0.5))

    scored = []
    for chunk, tf, length in docs:
        score = 0.0
        for term in terms:
            freq = tf.get(term, 0)
            if not freq:
                continue
            denom = freq + BM25_K1 * (1 - BM25_B + BM25_B * length / (avgdl or 1))
            score += idf(term) * (freq * (BM25_K1 + 1) / denom)
        if score > 0:
            scored.append(
                {
                    "id": chunk.id,
                    "title": chunk.title,
                    "text": chunk.text,
                    "score": round(score, 6),
                }
            )
    scored.sort(key=lambda item: item["score"], reverse=True)
    return scored[:limit]


def _vector_search(db: Session, query: str, limit: int) -> list[dict]:
    model = _get_model()
    if model is None:
        return []
    try:
        vector = list(next(iter(model.embed([query]))))
    except Exception:
        return []

    sql = text(
        """
        SELECT id, title, text, 1 - (embedding <=> CAST(:q AS vector)) AS score
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
        {"id": row.id, "title": row.title, "text": row.text, "score": float(row.score or 0)}
        for row in rows
    ]


def _rrf(*rankings: list[dict], limit: int) -> list[dict]:
    scores: dict[str, float] = {}
    items: dict[str, dict] = {}
    for ranking in rankings:
        for rank, item in enumerate(ranking, 1):
            items.setdefault(item["id"], item)
            scores[item["id"]] = scores.get(item["id"], 0.0) + 1.0 / (60 + rank)
    ordered = sorted(scores.items(), key=lambda pair: pair[1], reverse=True)
    out = []
    for chunk_id, score in ordered[:limit]:
        item = dict(items[chunk_id])
        item["score"] = round(score, 6)
        out.append(item)
    return out


def _relevant(items: list[dict]) -> list[dict]:
    """Keep only hits that clear the absolute and relative relevance floor."""
    if not items:
        return []
    best = float(items[0].get("score") or 0)
    floor = max(float(settings.rag_min_score or 0), best * RELATIVE_FLOOR)
    if best < floor:
        return []
    return [item for item in items if float(item.get("score") or 0) >= floor]


def _relevant_semantic(items: list[dict]) -> list[dict]:
    return [item for item in items if float(item.get("score") or 0) >= VECTOR_MIN_SCORE]


def retrieve(db: Session, query: str, limit: int = 3) -> list[dict]:
    query = str(query or "").strip()
    if not query:
        return []
    rows = list(
        db.scalars(
            select(KBChunk)
            .where(KBChunk.review_status == "reviewed")
            .order_by(KBChunk.id)
        ).all()
    )
    lexical = _relevant(_bm25(rows, query, max(limit, 20)))
    mode = (settings.rag_mode or "auto").lower()
    if mode == "keyword":
        return lexical[:limit]
    semantic = _relevant_semantic(_vector_search(db, query, max(limit, 20)))
    if not semantic:
        return lexical[:limit]
    return _rrf(semantic, lexical, limit=limit)


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
    """Embed reviewed chunks if a local model is available. Returns updated count."""
    model = _get_model()
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
        "mode": "vector" if embedded and _get_model() is not None else "keyword",
        "model": EMBEDDING_MODEL,
    }
