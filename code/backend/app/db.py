"""数据库引擎与会话辅助。"""
from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from .config import settings

DRIVER = "postgresql+psycopg://"


def normalize_url(raw: str) -> str:
    url = str(raw or "").strip()
    if not url:
        return ""
    for scheme in ("postgres://", "postgresql://", "pgconnect://", "postgresql+psycopg://"):
        if url.startswith(scheme):
            rest = url[len(scheme) :]
            return f"{DRIVER}{rest}"
    if url.startswith("sqlite"):  # explicitly unsupported: the app needs Postgres/pgvector
        return ""
    return url


def engine_kwargs(_url: str = "") -> dict:
    """小连接池 + 激进回收：Railway 这类主机会关闭空闲连接。"""
    return {
        "pool_pre_ping": True,
        "pool_recycle": 280,
        "pool_size": 3,
        "max_overflow": 3,
        "connect_args": {"connect_timeout": 10},
        "future": True,
    }


engine = create_engine(
    normalize_url(settings.database_url) or f"{DRIVER}invalid@127.0.0.1:1/invalid",
    **engine_kwargs(),
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
