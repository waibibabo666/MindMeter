"""assessment context: sleep / fatigue captured before the test

Revision ID: 0009_assessment_context
Revises: 0008_game_plays
Create Date: 2026-11-28

睡眠/疲劳只影响这一次解读的可信度，不改分数；以前只存在浏览器本地，
换设备就丢，报告和对话也拿不到。这里随测评落库一份白名单字段。
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0009_assessment_context"
down_revision = "0008_game_plays"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 幂等：CI 里 schema 初始化与 alembic 迁移可能先后各建一次，
    # 用 IF NOT EXISTS 避免 DuplicateColumn。
    op.execute(
        "ALTER TABLE assessments "
        "ADD COLUMN IF NOT EXISTS context JSONB NOT NULL DEFAULT '{}'::jsonb"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE assessments DROP COLUMN IF EXISTS context")
