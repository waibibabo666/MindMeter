"""per-play game score log for game-quality posteriors

Revision ID: 0008_game_plays
Revises: 0007_game_records
Create Date: 2026-11-26

game_records 只留最高分，单局成绩丢了，没法估计难度分布与区分度。
这张表只做流水：游戏仍然是练习，不进报告、趋势、导出。
"""
from __future__ import annotations

from alembic import op

revision = "0008_game_plays"
down_revision = "0007_game_records"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS game_plays (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          game_id TEXT NOT NULL,
          dim TEXT NOT NULL,
          score SMALLINT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS game_plays_game_created ON game_plays (game_id, created_at)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS game_plays")
