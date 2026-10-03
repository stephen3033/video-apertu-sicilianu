from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from starlette.datastructures import UploadFile
from starlette.responses import Response

from app.config import Settings
from app.db import get_db
from app.models import Submission, User
from app.repositories import EmptyMediaError, MediaTooLargeError, RepositoryError
from app.security import require_user, valid_csrf
from app.services.submissions import persist_submission, validate_media_type
from app.web import is_htmx, render_template


router = APIRouter(prefix="/submissions")


def _page(
    request: Request,
    fragment: str,
    *,
    user: User,
    **values: object,
) -> Response:
    if is_htmx(request):
        return render_template(request, fragment, user=user, **values)
    return render_template(
        request,
        "app_shell.html",
        user=user,
        content_template=fragment,
        **values,
    )


def _form_response(
    request: Request,
    *,
    user: User,
    errors: list[str],
    title: str,
    notes: str,
) -> Response:
    settings: Settings = request.app.state.settings
    values = {
        "errors": errors,
        "form_title": title,
        "form_notes": notes,
        "accept_extensions": ",".join(sorted(settings.extension_set)),
        "max_upload_bytes": settings.max_upload_bytes,
        "upload_limit_label": settings.upload_limit_label,
    }
    if is_htmx(request):
        return render_template(request, "fragments/submission_form.html", user=user, **values)
    return _page(request, "fragments/new_submission_page.html", user=user, **values)


@router.get("", name="submission_history")
def submission_history(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> Response:
    submissions = db.scalars(
        select(Submission)
        .where(Submission.user_id == user.id)
        .order_by(Submission.created_at.desc())
    ).all()
    return _page(
        request,
        "fragments/submission_history.html",
        user=user,
        submissions=submissions,
    )


@router.get("/new", name="new_submission")
def new_submission(request: Request, user: User = Depends(require_user)) -> Response:
    settings: Settings = request.app.state.settings
    return _page(
        request,
        "fragments/new_submission_page.html",
        user=user,
        errors=[],
        form_title="",
        form_notes="",
        accept_extensions=",".join(sorted(settings.extension_set)),
        max_upload_bytes=settings.max_upload_bytes,
        upload_limit_label=settings.upload_limit_label,
    )


@router.post("", name="create_submission")
async def create_submission(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> Response:
    settings: Settings = request.app.state.settings
    try:
        form = await request.form(
            max_files=1,
            max_fields=8,
            max_part_size=settings.max_upload_bytes,
        )
    except Exception:
        return _form_response(
            request,
            user=user,
            errors=["error.file_size"],
            title="",
            notes="",
        )

    title = str(form.get("title", "")).strip()
    notes = str(form.get("notes", "")).strip()
    upload = form.get("media")
    errors: list[str] = []

    if not valid_csrf(request, str(form.get("csrf_token", ""))):
        errors.append("error.csrf")
    if not title:
        errors.append("error.title_required")
    elif len(title) > 160:
        errors.append("error.title_long")
    if len(notes) > 2000:
        errors.append("error.notes_long")
    if not isinstance(upload, UploadFile):
        errors.append("error.file_required")
        media_details = None
    else:
        media_details = validate_media_type(upload, settings.extension_set)
        if media_details is None:
            errors.append("error.file_type")
        elif upload.size is not None and upload.size > settings.max_upload_bytes:
            errors.append("error.file_size")

    if errors:
        if isinstance(upload, UploadFile):
            await upload.close()
        return _form_response(request, user=user, errors=errors, title=title, notes=notes)

    assert isinstance(upload, UploadFile) and media_details is not None
    original_filename, extension, media_kind = media_details
    try:
        submission = await persist_submission(
            db=db,
            repository=request.app.state.media_repository,
            user=user,
            upload=upload,
            title=title,
            notes=notes or None,
            original_filename=original_filename,
            extension=extension,
            media_kind=media_kind,
            max_bytes=settings.max_upload_bytes,
        )
    except MediaTooLargeError:
        return _form_response(request, user=user, errors=["error.file_size"], title=title, notes=notes)
    except EmptyMediaError:
        return _form_response(request, user=user, errors=["error.file_empty"], title=title, notes=notes)
    except (RepositoryError, SQLAlchemyError):
        return _form_response(request, user=user, errors=["error.repository"], title=title, notes=notes)

    if is_htmx(request):
        return render_template(
            request,
            "fragments/submission_success.html",
            user=user,
            submission=submission,
        )
    return _page(
        request,
        "fragments/submission_success.html",
        user=user,
        submission=submission,
    )

