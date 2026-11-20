"""per-account intake profile (age / education / consent record)

Revision ID: 0005_profile
Revises: 0004_hosted_copy
Create Date: 2026-11-20

人工测试反馈：知情同意与年龄/学历被分成两页问，而且"只填一次"的状态存在
localStorage 里 —— 换浏览器/无痕窗口就会重新问。账号化之后这部分归到
`app_state.profile`（每账号一份），睡眠/疲劳这类每次都变的临场状态仍然只在
本次会话里，不落库。

不参与计分：这里存的只有分段参考与有效性标记所需的 age/edu/同意版本。
"""
from __future__ import annotations

from alembic import op

revision = "0005_profile"
down_revision = "0004_hosted_copy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS：全新库由 0001 的 create_all 直接带上新列。
    op.execute(
        """
        ALTER TABLE app_state
          ADD COLUMN IF NOT EXISTS profile JSONB NOT NULL DEFAULT '{}'::jsonb
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE app_state DROP COLUMN IF EXISTS profile")
