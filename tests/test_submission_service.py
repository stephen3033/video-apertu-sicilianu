from __future__ import annotations

from io import BytesIO

import pytest
from sqlalchemy.exc import SQLAlchemyError
from starlette.datastructures import Headers, UploadFile

from app.models import User
from app.services.submissions import persist_submission
from tests.conftest import FakeMediaRepository


class FailingSession:
    def __init__(self) -> None:
        self.rolled_back = False

    def add(self, _submission) -> None:
        pass

    def commit(self) -> None:
        raise SQLAlchemyError("database unavailable")

    def rollback(self) -> None:
        self.rolled_back = True


@pytest.mark.anyio
async def test_persistence_failure_removes_stored_media():
    repository = FakeMediaRepository()
    db = FailingSession()
    upload = UploadFile(
        file=BytesIO(b"media"),
        filename="recording.mp4",
        headers=Headers({"content-type": "video/mp4"}),
        size=5,
    )
    user = User(id="user-id", email="voice@example.com")

    with pytest.raises(SQLAlchemyError):
        await persist_submission(
            db=db,  # type: ignore[arg-type]
            repository=repository,
            user=user,
            upload=upload,
            title="Recording",
            notes=None,
            original_filename="recording.mp4",
            extension=".mp4",
            media_kind="video",
            max_bytes=100,
        )

    assert db.rolled_back is True
    assert repository.stored == {}
    assert len(repository.deleted) == 1
