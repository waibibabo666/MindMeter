"""initial local schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-11-14
"""
from __future__ import annotations

from alembic import op

from app.models import Base

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    Base.metadata.create_all(bind=bind)
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mm_app') THEN
            GRANT USAGE ON SCHEMA public TO mm_app;
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mm_app;
            GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mm_app;
            GRANT USAGE ON TYPE vector TO mm_app;
            ALTER DEFAULT PRIVILEGES IN SCHEMA public
              GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mm_app;
            ALTER DEFAULT PRIVILEGES IN SCHEMA public
              GRANT USAGE, SELECT ON SEQUENCES TO mm_app;
          END IF;
        END $$;
        """
    )


def downgrade() -> None:
    Base.metadata.drop_all(bind=op.get_bind())
