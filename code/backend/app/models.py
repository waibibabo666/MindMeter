"""SQLAlchemy models for the hosted multi-user MindMeter web app.

Two accounts tables (`users`, `auth_sessions`) own the login, and every
business table carries `user_id` as part of its primary key so one row can
never be read by another account. Natural ids stay exactly as the frontend
generates them (`s_xxx`, `msg_xxx`); they are only unique *per user*.

The knowledge base (`kb_chunks`) is shared read-only content, so it has no
user column. The LLM key never appears in any table: it comes from the
`MM_LLM_*` environment of the deployment (see `app.llm.site_llm_config`).
"""
from __future__ import annotations

from datetime import date, datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    ARRAY,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    SmallInteger,
    Text,
    func,
    text as sa_text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def user_pk() -> Mapped[int]:
    """Leading primary-key column: every business row belongs to exactly one account."""
    return mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )


def natural_pk() -> Mapped[str]:
    """Client-generated id that is unique per account, not globally."""
    return mapped_column(Text, primary_key=True)


def user_ref() -> Mapped[int | None]:
    """Optional telemetry owner (CASCADE keeps account deletion complete)."""
    return mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"))


# ---------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint("length(username) BETWEEN 2 AND 32", name="users_username_len"),
    )


class AuthSession(Base):
    """Server-side sessions: the cookie holds a random token, the DB holds only its hash."""

    __tablename__ = "auth_sessions"

    token_hash: Mapped[str] = mapped_column(Text, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ip: Mapped[str | None] = mapped_column(Text)
    user_agent: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (Index("auth_sessions_expires", "expires_at"),)


# ---------------------------------------------------------------------------
# Per-user product data
# ---------------------------------------------------------------------------


class AppState(Base):
    """One in-progress assessment per account (was a single-row table on desktop)."""

    __tablename__ = "app_state"

    user_id: Mapped[int] = user_pk()
    route: Mapped[str] = mapped_column(Text, nullable=False, server_default="/")
    tier: Mapped[str | None] = mapped_column(Text)
    consented: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sa_text("false")
    )
    consented_age: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sa_text("false")
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    task_order: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=sa_text("'{}'::text[]")
    )
    cursor: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    results: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=sa_text("'{}'::jsonb")
    )
    drafts: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=sa_text("'{}'::jsonb")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class Assessment(Base):
    __tablename__ = "assessments"

    user_id: Mapped[int] = user_pk()
    id: Mapped[str] = natural_pk()
    mode: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default="completed")
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    scoring_version: Mapped[str] = mapped_column(Text, nullable=False)
    dims: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=sa_text("'{}'::text[]")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        CheckConstraint("mode IN ('quick','standard','deep')", name="assessments_mode"),
        CheckConstraint("status IN ('completed','abandoned')", name="assessments_status"),
        Index("assessments_user_finished", "user_id", "finished_at"),
    )


class AssessmentTask(Base):
    __tablename__ = "assessment_tasks"

    user_id: Mapped[int] = user_pk()
    assessment_id: Mapped[str] = natural_pk()
    task_id: Mapped[str] = mapped_column(Text, primary_key=True)
    position: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    metrics: Mapped[dict] = mapped_column(JSONB, nullable=False)
    answers: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default=sa_text("'[]'::jsonb")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (
        ForeignKeyConstraint(
            ["user_id", "assessment_id"],
            ["assessments.user_id", "assessments.id"],
            ondelete="CASCADE",
        ),
    )


class AssessmentScore(Base):
    __tablename__ = "assessment_scores"

    user_id: Mapped[int] = user_pk()
    assessment_id: Mapped[str] = natural_pk()
    dimension: Mapped[str] = mapped_column(Text, primary_key=True)
    score: Mapped[int | None] = mapped_column(SmallInteger)
    scoring_version: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        CheckConstraint("score IS NULL OR (score >= 0 AND score <= 100)", name="score_range"),
        ForeignKeyConstraint(
            ["user_id", "assessment_id"],
            ["assessments.user_id", "assessments.id"],
            ondelete="CASCADE",
        ),
        Index("assessment_scores_dim", "user_id", "dimension"),
    )


class MemoryProfile(Base):
    __tablename__ = "memory_profile"

    user_id: Mapped[int] = user_pk()
    goal: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    preference: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    constraint: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    confirmed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sa_text("false")
    )
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class MemorySummary(Base):
    __tablename__ = "memory_summaries"

    user_id: Mapped[int] = user_pk()
    id: Mapped[str] = natural_pk()
    # Soft reference: assessments are keyed per user, so a single-column FK no
    # longer exists. Deleting a session keeps the summary text.
    assessment_id: Mapped[str | None] = mapped_column(Text)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    tier: Mapped[str] = mapped_column(Text, nullable=False)
    lowest_dim: Mapped[str | None] = mapped_column(Text)
    lowest_value: Mapped[int | None] = mapped_column(SmallInteger)
    advice_ids: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=sa_text("'{}'::text[]")
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (Index("memory_summaries_user_at", "user_id", "at"),)


class MemoryAdvice(Base):
    __tablename__ = "memory_advice"

    user_id: Mapped[int] = user_pk()
    id: Mapped[str] = natural_pk()
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    shown: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=sa_text("true"))
    done: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=sa_text("false"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (Index("memory_advice_user_at", "user_id", "at"),)


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    user_id: Mapped[int] = user_pk()
    id: Mapped[str] = natural_pk()
    role: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str | None] = mapped_column(Text)
    citations: Mapped[list] = mapped_column(
        JSONB, nullable=False, server_default=sa_text("'[]'::jsonb")
    )
    code: Mapped[str | None] = mapped_column(Text)
    risk: Mapped[str | None] = mapped_column(Text)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")

    __table_args__ = (
        CheckConstraint("role IN ('user','assistant')", name="chat_role"),
        Index("chat_messages_user_seq", "user_id", "seq"),
    )


class AIRun(Base):
    """Per-request AI telemetry. `user_id` is kept for auditing, never shown in the UI."""

    __tablename__ = "ai_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = user_ref()
    assessment_id: Mapped[str | None] = mapped_column(Text)
    model: Mapped[str | None] = mapped_column(Text)
    intent: Mapped[str | None] = mapped_column(Text)
    latency_ms: Mapped[int | None] = mapped_column(Integer)
    degraded: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sa_text("false")
    )
    error_code: Mapped[str | None] = mapped_column(Text)
    validation: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (Index("ai_runs_user_created", "user_id", "created_at"),)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = user_ref()
    action: Mapped[str] = mapped_column(Text, nullable=False)
    object: Mapped[str | None] = mapped_column(Text)
    result: Mapped[str] = mapped_column(Text, nullable=False)
    detail: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    __table_args__ = (Index("audit_log_user_created", "user_id", "created_at"),)


class KBChunk(Base):
    """Shared, read-only knowledge base (seeded by migration 0002)."""

    __tablename__ = "kb_chunks"

    id: Mapped[str] = mapped_column(Text, primary_key=True)
    category: Mapped[str] = mapped_column(Text, nullable=False)
    dims: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=sa_text("'{}'::text[]")
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[dict] = mapped_column(JSONB, nullable=False)
    version: Mapped[str] = mapped_column(Text, nullable=False)
    risk: Mapped[str] = mapped_column(Text, nullable=False)
    review_status: Mapped[str] = mapped_column(Text, nullable=False)
    reviewed_by: Mapped[str | None] = mapped_column(Text)
    reviewed_at: Mapped[date | None] = mapped_column(Date)
    tags: Mapped[list[str]] = mapped_column(
        ARRAY(Text), nullable=False, server_default=sa_text("'{}'::text[]")
    )
    param: Mapped[str | None] = mapped_column(Text)
    content_hash: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    embedding: Mapped[list[float] | None] = mapped_column(Vector(512))
    embedding_model: Mapped[str | None] = mapped_column(Text)
    embedded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
