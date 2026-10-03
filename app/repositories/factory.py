from __future__ import annotations

from app.config import Settings
from app.repositories.base import MediaRepository
from app.repositories.local import LocalMediaRepository


def build_media_repository(settings: Settings) -> MediaRepository:
    if settings.storage_backend == "local":
        return LocalMediaRepository(settings.storage_root)
    raise ValueError(f"Unsupported media repository backend: {settings.storage_backend}")
