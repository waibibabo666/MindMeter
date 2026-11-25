"""Conversation memory: read the prompt context, keep recent turns, sediment.

One class owns the whole per-user memory surface so ``api/chat.py`` no longer
carries the SQL for profile/summary/advice/messages.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .models import ChatMessage, MemoryAdvice, MemoryProfile, MemorySummary, User

KEEP_MESSAGES = 20
HISTORY_MESSAGES = 6


def _now() -> datetime:
    return datetime.now(timezone.utc)


class MemoryStore:
    """Per-user memory: profile + latest summary + recent advice + messages."""

    def __init__(self, db: Session, user: User) -> None:
        self.db = db
        self.user = user
        self.user_id = int(user.id)

    def context(self) -> dict:
        """What the prompt is allowed to see (never the raw conversation)."""
        profile_row = self.db.get(MemoryProfile, self.user_id)
        profile = None
        if profile_row is not None and profile_row.confirmed:
            profile = {
                "goal": profile_row.goal,
                "preference": profile_row.preference,
                "constraint": profile_row.constraint,
                "confirmed": True,
            }
        latest = self.db.scalar(
            select(MemorySummary)
            .where(MemorySummary.user_id == self.user_id)
            .order_by(MemorySummary.at.desc())
            .limit(1)
        )
        advice = list(
            self.db.scalars(
                select(MemoryAdvice)
                .where(MemoryAdvice.user_id == self.user_id)
                .order_by(MemoryAdvice.at.desc())
                .limit(5)
            ).all()
        )
        return {
            "profile": profile,
            "summaryText": latest.text if latest else None,
            "advice": [
                {"id": item.id, "title": item.title, "done": item.done}
                for item in reversed(advice)
            ],
        }

    def history(self, limit: int = HISTORY_MESSAGES) -> list[dict]:
        rows = list(
            self.db.scalars(
                select(ChatMessage)
                .where(ChatMessage.user_id == self.user_id)
                .order_by(ChatMessage.seq.desc())
                .limit(limit)
            ).all()
        )
        return [{"role": row.role, "content": row.content} for row in reversed(rows)]

    def append(
        self,
        role: str,
        content: str,
        *,
        source: str | None = None,
        citations: list | None = None,
        code: str | None = None,
        risk: str | None = None,
    ) -> ChatMessage:
        seq = self._next_seq()
        row = ChatMessage(
            user_id=self.user_id,
            id=f"msg_{int(_now().timestamp() * 1000)}_{seq}",
            role=role,
            content=content,
            source=source,
            citations=citations or [],
            code=code,
            risk=risk,
            at=_now(),
            seq=seq,
        )
        self.db.add(row)
        self.db.flush()
        self._trim()
        return row

    def sediment(
        self,
        *,
        question: str,
        reply: dict,
        facts: dict | None,
        assessment_id: str | None,
        tier: str | None,
    ) -> dict:
        """After a qualifying turn, write summary/advice (never blocks the reply)."""
        from .agent.insights import after_turn

        return after_turn(
            self.db,
            self.user,
            question=question,
            reply=reply,
            facts=facts,
            assessment_id=assessment_id,
            tier=tier,
        )

    def _next_seq(self) -> int:
        current = self.db.scalar(
            select(ChatMessage.seq)
            .where(ChatMessage.user_id == self.user_id)
            .order_by(ChatMessage.seq.desc())
            .limit(1)
        )
        return int(current or 0) + 1

    def _trim(self) -> None:
        keep = list(
            self.db.scalars(
                select(ChatMessage.id)
                .where(ChatMessage.user_id == self.user_id)
                .order_by(ChatMessage.seq.desc())
                .limit(KEEP_MESSAGES)
            ).all()
        )
        if not keep:
            return
        self.db.execute(
            delete(ChatMessage).where(
                ChatMessage.user_id == self.user_id, ChatMessage.id.not_in(keep)
            )
        )
