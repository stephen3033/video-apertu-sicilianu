from __future__ import annotations

from collections.abc import Generator
from pathlib import Path

from fastapi import Request
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.engine.url import make_url
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    pass


def ensure_database_parent(database_url: str) -> None:
    """Create the parent directory for a file-backed SQLite database."""
    url = make_url(database_url)
    if not url.drivername.startswith("sqlite") or not url.database or url.database == ":memory:":
        return
    database_path = Path(url.database).expanduser()
    if not database_path.is_absolute():
        database_path = Path.cwd() / database_path
    database_path.parent.mkdir(parents=True, exist_ok=True)


def build_engine(database_url: str) -> Engine:
    ensure_database_parent(database_url)
    connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
    return create_engine(database_url, connect_args=connect_args)


def build_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False)


def get_db(request: Request) -> Generator[Session, None, None]:
    session_factory = request.app.state.session_factory
    with session_factory() as session:
        yield session
