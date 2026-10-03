"""Create users and submissions.

Revision ID: 20260921_0001
Revises:
Create Date: 2026-09-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "20260921_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)
    op.create_table(
        "submissions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("media_kind", sa.String(length=16), nullable=False),
        sa.Column("content_type", sa.String(length=128), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("storage_ref", sa.String(length=512), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("storage_ref"),
    )
    op.create_index(op.f("ix_submissions_created_at"), "submissions", ["created_at"], unique=False)
    op.create_index(op.f("ix_submissions_user_id"), "submissions", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_submissions_user_id"), table_name="submissions")
    op.drop_index(op.f("ix_submissions_created_at"), table_name="submissions")
    op.drop_table("submissions")
    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_table("users")

