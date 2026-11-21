"""practice game records, one row per account and game

Revision ID: 0007_game_records
Revises: 0006_align_kb
Create Date: 2026-11-21

游戏成绩原来只存在浏览器 localStorage：同一台电脑换账号登录时，两个人会
看到对方的最佳成绩。账号化之后改为每账号一行；游戏仍然只是练习，不进报告、
不进趋势、不进导出。

注意链在 0006_align_kb 之后：本条与知识库对齐迁移是并行开发的，两条都从
0005_profile 分叉会让 alembic 出现两个 head。
"""
from __future__ import annotations

from alembic import op

revision = "0007_game_records"
down_revision = "0006_align_kb"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS game_records (
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          game_id TEXT NOT NULL,
          best SMALLINT NOT NULL DEFAULT 0,
          plays INTEGER NOT NULL DEFAULT 0,
          last_score SMALLINT NOT NULL DEFAULT 0,
          last_at TIMESTAMPTZ,
          PRIMARY KEY (user_id, game_id)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS game_records")
