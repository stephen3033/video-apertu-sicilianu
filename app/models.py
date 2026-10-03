from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid4())


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    email_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    submissions: Mapped[list[Submission]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class LoginChallenge(Base):
    __tablename__ = "login_challenges"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String(320), index=True)
    code_digest: Mapped[str] = mapped_column(String(64))
    locale: Mapped[str] = mapped_column(String(3))
    requester_ip_hash: Mapped[str] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, index=True
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    attempt_window_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0)
    consumed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class Submission(Base):
    __tablename__ = "submissions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(160))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    original_filename: Mapped[str] = mapped_column(String(255))
    media_kind: Mapped[str] = mapped_column(String(16))
    content_type: Mapped[str] = mapped_column(String(128))
    byte_size: Mapped[int]
    storage_ref: Mapped[str] = mapped_column(String(512), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)

    user: Mapped[User] = relationship(back_populates="submissions")
