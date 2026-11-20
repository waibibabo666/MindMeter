"""Database engine/session helpers.

Creating the engine does not connect. Migrations are run by the deploy
(``alembic upgrade head`` in the start command), and FastAPI only connects when
a request needs the database.

Hosted Postgres strings come in several dialects, so ``normalize_url`` accepts
what the host (and a plain ``postgres://...`` handoff) actually gives you and
rewrites it to the psycopg3 driver this app uses.
"""
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
    """A small pool plus aggressive recycling: hosts like Railway close idle conns."""
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
