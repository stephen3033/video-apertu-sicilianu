from __future__ import annotations

import os
from pathlib import Path
from uuid import uuid4

import aiofiles
from starlette.datastructures import UploadFile

from app.repositories.base import EmptyMediaError, MediaTooLargeError, RepositoryError, StoredMedia


class LocalMediaRepository:
    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def _resolve(self, reference: str) -> Path:
        destination = (self.root / reference).resolve()
        if not destination.is_relative_to(self.root):
            raise RepositoryError("Invalid storage reference")
        return destination

    async def store(
        self,
        upload: UploadFile,
        *,
        key: str,
        max_bytes: int,
    ) -> StoredMedia:
        destination = self._resolve(key)
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(f".{destination.name}.{uuid4().hex}.part")
        byte_size = 0

        try:
            async with aiofiles.open(temporary, "wb") as output:
                while chunk := await upload.read(1024 * 1024):
                    byte_size += len(chunk)
                    if byte_size > max_bytes:
                        raise MediaTooLargeError
                    await output.write(chunk)
            if byte_size == 0:
                raise EmptyMediaError
            os.replace(temporary, destination)
        except (MediaTooLargeError, EmptyMediaError):
            temporary.unlink(missing_ok=True)
            raise
        except OSError as exc:
            temporary.unlink(missing_ok=True)
            raise RepositoryError("Unable to store media") from exc
        finally:
            await upload.close()

        return StoredMedia(reference=key, byte_size=byte_size)

    async def delete(self, reference: str) -> None:
        try:
            self._resolve(reference).unlink(missing_ok=True)
        except OSError as exc:
            raise RepositoryError("Unable to remove media") from exc

