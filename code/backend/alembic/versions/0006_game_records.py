"""practice game records, one row per account and game

Revision ID: 0006_game_records
Revises: 0005_profile
Create Date: 2026-11-21

游戏成绩原来只存在浏览器 localStorage：同一台电脑换账号登录时，两个人会
看到对方的最佳成绩。账号化之后改为每账号一行；游戏仍然只是练习，不进报告、
不进趋势、不进导出。

全新库由 0001 的 `create_all` 直接建表，这里的 IF NOT EXISTS 只服务升级库。
"""
from __future__ import annotations

from alembic import op

revision = "0006_game_records"
down_revision = "0005_profile"
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
