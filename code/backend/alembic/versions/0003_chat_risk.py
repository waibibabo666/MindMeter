"""add chat message risk marker

Revision ID: 0003_chat_risk
Revises: 0002_seed_kb
Create Date: 2026-11-14
"""
from __future__ import annotations

from alembic import op

revision = "0003_chat_risk"
down_revision = "0002_seed_kb"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS keeps this safe on fresh databases where create_all already
    # created the column from the current model.
    op.execute("ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS risk TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE chat_messages DROP COLUMN IF EXISTS risk")
