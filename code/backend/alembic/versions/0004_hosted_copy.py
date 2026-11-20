"""hosted deployment: refresh the privacy knowledge chunk

Revision ID: 0004_hosted_copy
Revises: 0003_chat_risk
Create Date: 2026-11-19

The desktop build could say "data never leaves this computer"; the hosted build
cannot. kb-limit-04 is the chunk the Agent is allowed to quote about storage,
so it is rewritten here for databases that already ran 0002_seed_kb.

This revision also fails loudly on a legacy single-user database: the web app
keys every business table by user_id (docs/adr/0003), and there is no honest
automatic migration for that — it needs a fresh database.
"""
from __future__ import annotations

import hashlib

import sqlalchemy as sa
from alembic import op

revision = "0004_hosted_copy"
down_revision = "0003_chat_risk"
branch_labels = None
depends_on = None

CHUNK_ID = "kb-limit-04"
NEW_TEXT = (
    "作答数据与报告保存在站点的 PostgreSQL 数据库里，按账号隔离：只有登录这个账号的浏览器能看到。"
    "你可以在设置中导出本账号数据，也可以一键清除或注销账号；清除后不可恢复。"
    "使用公共设备时请记得退出登录。手机号、身份证号等敏感信息在发送前会被检测并脱敏；"
    "模型服务由站点统一配置，你的问题会发送给站点配置的模型服务。"
)
NEW_TITLE = "数据存在哪里"
NEW_TAGS = ["隐私", "账号", "数据"]
NEW_SOURCE = (
    '{"kind": "product", "title": "MindMeter Web 部署与账号决策", "author": '
    '"MindMeter 团队", "year": 2026, '
    '"locator": "docs/adr/0003-web-accounts-and-hosted-deployment.md"}'
)


def _content_hash(title: str, text: str, tags: list[str]) -> str:
    payload = "\n".join([title, text, " ".join(tags)])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def upgrade() -> None:
    bind = op.get_bind()
    legacy = bind.execute(
        sa.text("SELECT to_regclass('public.users') IS NULL AS single_user")
    ).scalar()
    if legacy:
        raise RuntimeError(
            "这是桌面单用户数据库：Web 多用户需要全新数据库。"
            "本地请用 scripts/init_web_db.ps1（或删掉 runtime/data/pgdata 后重跑迁移）；"
            "托管平台上请新建一个 pgvector Postgres 实例。"
        )
    bind.execute(
        sa.text(
            """
            UPDATE kb_chunks
               SET title = :title,
                   text = :text,
                   tags = CAST(:tags AS text[]),
                   source = CAST(:source AS jsonb),
                   version = '1.1',
                   content_hash = :hash
             WHERE id = :id
            """
        ),
        {
            "id": CHUNK_ID,
            "title": NEW_TITLE,
            "text": NEW_TEXT,
            "tags": NEW_TAGS,
            "source": NEW_SOURCE,
            "hash": _content_hash(NEW_TITLE, NEW_TEXT, NEW_TAGS),
        },
    )


def downgrade() -> None:
    """No rollback target: the previous wording is no longer true for this build."""
