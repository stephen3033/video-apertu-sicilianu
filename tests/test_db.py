from __future__ import annotations

from sqlalchemy import text

from app.db import build_engine, ensure_database_parent


def test_file_backed_sqlite_creates_missing_parent_directory(tmp_path):
    database_path = tmp_path / "nested" / "directory" / "app.db"
    engine = build_engine(f"sqlite:///{database_path}")

    with engine.connect() as connection:
        connection.execute(text("select 1"))

    assert database_path.exists()
    engine.dispose()


def test_in_memory_sqlite_does_not_create_a_directory(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    ensure_database_parent("sqlite:///:memory:")

    assert list(tmp_path.iterdir()) == []
