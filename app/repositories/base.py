from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from starlette.datastructures import UploadFile


class RepositoryError(Exception):
    """The configured media repository could not complete an operation."""


class MediaTooLargeError(RepositoryError):
    """The media stream exceeded the configured limit."""


class EmptyMediaError(RepositoryError):
    """The uploaded stream contained no bytes."""


@dataclass(frozen=True)
class StoredMedia:
    reference: str
    byte_size: int


class MediaRepository(Protocol):
    async def store(
        self,
        upload: UploadFile,
        *,
        key: str,
        max_bytes: int,
    ) -> StoredMedia: ...

    async def delete(self, reference: str) -> None: ...

