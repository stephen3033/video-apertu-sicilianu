from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from app.config import PROJECT_ROOT, get_settings


def test_passwordless_migration_preserves_user_and_owned_submission(
    tmp_path: Path, monkeypatch
):
    database_path = tmp_path / "migration.db"
    database_url = f"sqlite:///{database_path}"
    monkeypatch.setenv("VAS_DATABASE_URL", database_url)
    get_settings.cache_clear()
    config = Config(str(PROJECT_ROOT / "alembic.ini"))
    command.upgrade(config, "20260921_0001")

    now = datetime.now(timezone.utc)
    engine = create_engine(database_url)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO users (id, email, password_hash, created_at) "
                "VALUES (:id, :email, :password_hash, :created_at)"
            ),
            {
                "id": "existing-user",
                "email": "voice@example.com",
                "password_hash": "legacy-secret-hash",
                "created_at": now,
            },
        )
        connection.execute(
            text(
                "INSERT INTO submissions "
                "(id, user_id, title, notes, original_filename, media_kind, "
                "content_type, byte_size, storage_ref, created_at) VALUES "
                "(:id, :user_id, :title, NULL, :filename, :kind, :content_type, "
                ":byte_size, :storage_ref, :created_at)"
            ),
            {
                "id": "existing-submission",
                "user_id": "existing-user",
                "title": "Existing recording",
                "filename": "recording.mp4",
                "kind": "video",
                "content_type": "video/mp4",
                "byte_size": 12,
                "storage_ref": "existing/ref",
                "created_at": now,
            },
        )
    engine.dispose()

    command.upgrade(config, "head")

    engine = create_engine(database_url)
    column_names = {column["name"] for column in inspect(engine).get_columns("users")}
    with engine.connect() as connection:
        user = connection.execute(
            text("SELECT id, email, email_verified_at FROM users")
        ).one()
        submission = connection.execute(
            text("SELECT id, user_id FROM submissions")
        ).one()
    engine.dispose()
    get_settings.cache_clear()

    assert "password_hash" not in column_names
    assert "email_verified_at" in column_names
    assert tuple(user) == ("existing-user", "voice@example.com", None)
    assert tuple(submission) == ("existing-submission", "existing-user")
