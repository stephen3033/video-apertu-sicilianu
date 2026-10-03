"""Replace passwords with email login challenges.

Revision ID: 20260921_0002
Revises: 20260921_0001
Create Date: 2026-09-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "20260921_0002"
down_revision: str | None = "20260921_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(
            sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True)
        )
        batch_op.drop_column("password_hash")

    op.create_table(
        "login_challenges",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("code_digest", sa.String(length=64), nullable=False),
        sa.Column("locale", sa.String(length=3), nullable=False),
        sa.Column("requester_ip_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("attempt_window_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("failed_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_login_challenges_email"),
        "login_challenges",
        ["email"],
        unique=False,
    )
    op.create_index(
        op.f("ix_login_challenges_requester_ip_hash"),
        "login_challenges",
        ["requester_ip_hash"],
        unique=False,
    )
    op.create_index(
        op.f("ix_login_challenges_created_at"),
        "login_challenges",
        ["created_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_login_challenges_expires_at"),
        "login_challenges",
        ["expires_at"],
        unique=False,
    )


def downgrade() -> None:
    raise RuntimeError(
        "The passwordless authentication migration is intentionally irreversible."
    )
