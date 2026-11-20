"""seed the 30 reviewed knowledge chunks

Revision ID: 0002_seed_kb
Revises: 0001_initial
Create Date: 2026-11-14
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import sqlalchemy as sa
from alembic import op

revision = "0002_seed_kb"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def _hash(row: dict) -> str:
    payload = "\n".join(
        [str(row.get("title", "")), str(row.get("text", "")), " ".join(row.get("tags") or [])]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def upgrade() -> None:
    seed_path = Path(__file__).resolve().parents[2] / "app" / "rag" / "kb_seed.json"
    rows = json.loads(seed_path.read_text(encoding="utf-8"))
    statement = sa.text(
        """
        INSERT INTO kb_chunks
          (id, category, dims, title, text, source, version, risk, review_status,
           reviewed_by, reviewed_at, tags, param, content_hash)
        VALUES
          (:id, :category, CAST(:dims AS text[]), :title, :text, CAST(:source AS jsonb),
           :version, :risk, :review_status, :reviewed_by, CAST(:reviewed_at AS date),
           CAST(:tags AS text[]), :param, :content_hash)
        ON CONFLICT (id) DO NOTHING
        """
    )
    bind = op.get_bind()
    for row in rows:
        bind.execute(
            statement,
            {
                "id": row["id"],
                "category": row["category"],
                "dims": row.get("dims") or [],
                "title": row["title"],
                "text": row["text"],
                "source": json.dumps(row.get("source") or {}, ensure_ascii=False),
                "version": row.get("version") or "1.0",
                "risk": row.get("risk") or "low",
                "review_status": row.get("review_status") or "draft",
                "reviewed_by": row.get("reviewed_by"),
                "reviewed_at": row.get("reviewed_at"),
                "tags": row.get("tags") or [],
                "param": row.get("param"),
                "content_hash": _hash(row),
            },
        )


def downgrade() -> None:
    seed_path = Path(__file__).resolve().parents[2] / "app" / "rag" / "kb_seed.json"
    rows = json.loads(seed_path.read_text(encoding="utf-8"))
    ids = [row["id"] for row in rows]
    if ids:
        op.get_bind().execute(
            sa.text("DELETE FROM kb_chunks WHERE id = ANY(:ids)"), {"ids": ids}
        )
