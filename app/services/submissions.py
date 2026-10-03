from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile

from app.models import Submission, User
from app.repositories import MediaRepository, StoredMedia


VIDEO_EXTENSIONS = frozenset({".mp4", ".m4v", ".mov", ".webm", ".mkv", ".avi"})
AUDIO_EXTENSIONS = frozenset({".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus"})


def validate_media_type(
    upload: UploadFile,
    allowed_extensions: frozenset[str],
) -> tuple[str, str, str] | None:
    original_filename = Path((upload.filename or "").replace("\x00", "")).name.strip()
    extension = Path(original_filename).suffix.lower()
    content_type = (upload.content_type or "").split(";", 1)[0].lower()

    if not original_filename or extension not in allowed_extensions:
        return None
    if extension in VIDEO_EXTENSIONS and content_type.startswith("video/"):
        return original_filename, extension, "video"
    if extension in AUDIO_EXTENSIONS and (
        content_type.startswith("audio/") or (extension == ".ogg" and content_type == "application/ogg")
    ):
        return original_filename, extension, "audio"
    return None


def storage_key(user: User, extension: str) -> str:
    now = datetime.now(timezone.utc)
    return f"{user.id}/{now:%Y/%m}/{uuid4().hex}{extension}"


async def persist_submission(
    *,
    db: Session,
    repository: MediaRepository,
    user: User,
    upload: UploadFile,
    title: str,
    notes: str | None,
    original_filename: str,
    extension: str,
    media_kind: str,
    max_bytes: int,
) -> Submission:
    stored: StoredMedia = await repository.store(
        upload,
        key=storage_key(user, extension),
        max_bytes=max_bytes,
    )
    submission = Submission(
        user_id=user.id,
        title=title,
        notes=notes,
        original_filename=original_filename,
        media_kind=media_kind,
        content_type=(upload.content_type or "application/octet-stream").split(";", 1)[0],
        byte_size=stored.byte_size,
        storage_ref=stored.reference,
    )
    try:
        db.add(submission)
        db.commit()
    except Exception:
        db.rollback()
        await repository.delete(stored.reference)
        raise
    db.refresh(submission)
    return submission
