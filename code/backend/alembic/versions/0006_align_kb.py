"""align knowledge chunks with the current assessment tasks

2026-11-21:
  * 13 条旧块按现行任务改写（am 改为 PAL、ps 改为编码+颜色分类、
    sv 补充折叠/展开图、vc 题量按档位、言语题型补关系类比）；
  * 新增 12 条 dim 块，覆盖原先缺失的 nc / ir / ni / vf 四个维度。

实现方式：从 kb_seed.json 读全部 42 条，按 id upsert。
这样新建库与老库都能得到同一份内容；0002 的种子保持不动。

Downgrade 只删除本次新增的 12 条（reviewed_at = 2026-11-21），
不还原旧文案 —— 旧文案是过时描述，没有恢复的意义。

Revision ID: 0006_align_kb
Revises: 0005_profile
Create Date: 2026-11-21
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import sqlalchemy as sa
from alembic import op

revision = "0006_align_kb"
down_revision = "0005_profile"
branch_labels = None
depends_on = None

NEW_IDS = [
    "kb-dim-nc-01",
    "kb-dim-nc-02",
    "kb-dim-nc-03",
    "kb-dim-ir-01",
    "kb-dim-ir-02",
    "kb-dim-ir-03",
    "kb-dim-ni-01",
    "kb-dim-ni-02",
    "kb-dim-ni-03",
    "kb-dim-vf-01",
    "kb-dim-vf-02",
    "kb-dim-vf-03",
]


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
        ON CONFLICT (id) DO UPDATE SET
          category = EXCLUDED.category,
          dims = EXCLUDED.dims,
          title = EXCLUDED.title,
          text = EXCLUDED.text,
          source = EXCLUDED.source,
          version = EXCLUDED.version,
          risk = EXCLUDED.risk,
          review_status = EXCLUDED.review_status,
          reviewed_by = EXCLUDED.reviewed_by,
          reviewed_at = EXCLUDED.reviewed_at,
          tags = EXCLUDED.tags,
          param = EXCLUDED.param,
          content_hash = EXCLUDED.content_hash,
          embedding = NULL
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
    op.get_bind().execute(
        sa.text("DELETE FROM kb_chunks WHERE id = ANY(:ids)"), {"ids": NEW_IDS}
    )
