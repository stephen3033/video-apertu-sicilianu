from __future__ import annotations

from io import BytesIO

import pytest
from starlette.datastructures import Headers, UploadFile

from app.repositories import MediaTooLargeError
from app.repositories.local import LocalMediaRepository


@pytest.mark.anyio
async def test_local_repository_writes_and_deletes_atomically(tmp_path):
    repository = LocalMediaRepository(tmp_path)
    upload = UploadFile(
        file=BytesIO(b"abc"),
        filename="voice.mp3",
        headers=Headers({"content-type": "audio/mpeg"}),
        size=3,
    )
    result = await repository.store(upload, key="user/2026/09/id.mp3", max_bytes=10)

    assert result.byte_size == 3
    assert (tmp_path / result.reference).read_bytes() == b"abc"
    await repository.delete(result.reference)
    assert not (tmp_path / result.reference).exists()


@pytest.mark.anyio
async def test_local_repository_removes_partial_oversized_file(tmp_path):
    repository = LocalMediaRepository(tmp_path)
    upload = UploadFile(file=BytesIO(b"too large"), filename="voice.mp3", size=9)

    with pytest.raises(MediaTooLargeError):
        await repository.store(upload, key="user/id.mp3", max_bytes=3)

    assert list(tmp_path.rglob("*.*")) == []
