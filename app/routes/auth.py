from __future__ import annotations

import math
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, Request
from sqlalchemy import case, delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.responses import RedirectResponse, Response

from app.auth_codes import (
    code_digest,
    generate_code,
    requester_ip_digest,
    valid_code_format,
)
from app.config import Settings
from app.db import get_db
from app.models import LoginChallenge, User, new_id
from app.security import normalize_email, session_user, start_user_session, valid_csrf
from app.web import is_htmx, render_template


router = APIRouter()
SUPPORTED_LOCALES = frozenset({"en", "scn", "it"})


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _locale(value: str) -> str:
    return value if value in SUPPORTED_LOCALES else "en"


def _masked_email(email: str) -> str:
    local, domain = email.rsplit("@", 1)
    return f"{local[:1]}***@{domain}"


def _cleanup_challenges(db: Session, settings: Settings, now: datetime) -> None:
    cutoff = now - timedelta(seconds=settings.auth_challenge_retention_seconds)
    db.execute(delete(LoginChallenge).where(LoginChallenge.created_at < cutoff))
    db.commit()


def _email_panel(
    request: Request,
    *,
    errors: list[str] | None = None,
    email: str = "",
    locale: str = "en",
    status_code: int = 200,
    headers: dict[str, str] | None = None,
) -> Response:
    values: dict[str, Any] = {
        "auth_template": "fragments/email_card.html",
        "auth_errors": errors or [],
        "auth_email": email,
        "auth_locale": locale,
    }
    template = "fragments/email_card.html" if is_htmx(request) else "home.html"
    return render_template(
        request, template, status_code=status_code, headers=headers, **values
    )


def _code_panel(
    request: Request,
    challenge: LoginChallenge,
    *,
    errors: list[str] | None = None,
    notice: str | None = None,
    status_code: int = 200,
    headers: dict[str, str] | None = None,
) -> Response:
    values: dict[str, Any] = {
        "auth_template": "fragments/code_card.html",
        "auth_errors": errors or [],
        "auth_locale": challenge.locale,
        "challenge_id": challenge.id,
        "masked_email": _masked_email(challenge.email),
        "auth_notice": notice,
    }
    template = "fragments/code_card.html" if is_htmx(request) else "home.html"
    return render_template(
        request, template, status_code=status_code, headers=headers, **values
    )


def _signed_in_response(request: Request) -> Response:
    destination = str(request.url_for("new_submission"))
    if is_htmx(request):
        return Response(status_code=204, headers={"HX-Redirect": destination})
    return RedirectResponse(destination, status_code=303)


def _client_ip_hash(request: Request, settings: Settings) -> str:
    address = request.client.host if request.client else "unknown"
    return requester_ip_digest(settings.auth_code_secret, address)


def _retry_after(
    db: Session,
    settings: Settings,
    *,
    email: str,
    ip_hash: str,
    now: datetime,
) -> int | None:
    waits: list[float] = []
    latest = db.scalar(
        select(LoginChallenge.created_at)
        .where(LoginChallenge.email == email)
        .order_by(LoginChallenge.created_at.desc())
        .limit(1)
    )
    if latest is not None:
        remaining = settings.auth_code_resend_cooldown_seconds - (
            now - _aware(latest)
        ).total_seconds()
        if remaining > 0:
            waits.append(remaining)

    email_cutoff = now - timedelta(seconds=settings.auth_code_email_window_seconds)
    email_sends = db.scalar(
        select(func.count(LoginChallenge.id)).where(
            LoginChallenge.email == email,
            LoginChallenge.created_at >= email_cutoff,
        )
    ) or 0
    if email_sends >= settings.auth_code_email_limit:
        earliest = db.scalar(
            select(LoginChallenge.created_at)
            .where(
                LoginChallenge.email == email,
                LoginChallenge.created_at >= email_cutoff,
            )
            .order_by(LoginChallenge.created_at)
            .limit(1)
        )
        if earliest is not None:
            waits.append(
                settings.auth_code_email_window_seconds
                - (now - _aware(earliest)).total_seconds()
            )

    ip_cutoff = now - timedelta(seconds=settings.auth_code_ip_window_seconds)
    ip_sends = db.scalar(
        select(func.count(LoginChallenge.id)).where(
            LoginChallenge.requester_ip_hash == ip_hash,
            LoginChallenge.created_at >= ip_cutoff,
        )
    ) or 0
    if ip_sends >= settings.auth_code_ip_limit:
        earliest = db.scalar(
            select(LoginChallenge.created_at)
            .where(
                LoginChallenge.requester_ip_hash == ip_hash,
                LoginChallenge.created_at >= ip_cutoff,
            )
            .order_by(LoginChallenge.created_at)
            .limit(1)
        )
        if earliest is not None:
            waits.append(
                settings.auth_code_ip_window_seconds
                - (now - _aware(earliest)).total_seconds()
            )
    positive_waits = [wait for wait in waits if wait > 0]
    return max(1, math.ceil(max(positive_waits))) if positive_waits else None


def _latest_unexpired_challenge_for_email(
    db: Session, email: str, now: datetime
) -> LoginChallenge | None:
    return db.scalar(
        select(LoginChallenge)
        .where(
            LoginChallenge.email == email,
            LoginChallenge.expires_at > now,
        )
        .order_by(LoginChallenge.created_at.desc())
        .limit(1)
    )


@router.get("/", name="home")
def home(request: Request, db: Session = Depends(get_db)) -> Response:
    if session_user(request, db) is not None:
        return RedirectResponse(request.url_for("new_submission"), status_code=303)
    _cleanup_challenges(db, request.app.state.settings, _now())
    return render_template(
        request,
        "home.html",
        auth_template="fragments/email_card.html",
        auth_errors=[],
        auth_email="",
        auth_locale="en",
    )


@router.get("/auth/email", name="email_form")
def email_form(request: Request, db: Session = Depends(get_db)) -> Response:
    if session_user(request, db) is not None:
        return _signed_in_response(request)
    _cleanup_challenges(db, request.app.state.settings, _now())
    if not is_htmx(request):
        return RedirectResponse(request.url_for("home"), status_code=303)
    return _email_panel(request)


@router.post("/auth/code/request", name="request_login_code")
async def request_login_code(
    request: Request, db: Session = Depends(get_db)
) -> Response:
    settings: Settings = request.app.state.settings
    now = _now()
    _cleanup_challenges(db, settings, now)
    form = await request.form(max_fields=6, max_files=0)
    email_input = str(form.get("email", "")).strip()
    locale = _locale(str(form.get("locale", "en")))
    errors: list[str] = []
    if not valid_csrf(request, str(form.get("csrf_token", ""))):
        errors.append("error.csrf")
    try:
        email = normalize_email(email_input)
    except ValueError:
        email = email_input
        errors.append("error.email")
    if errors:
        return _email_panel(
            request, errors=errors, email=email_input, locale=locale
        )

    ip_hash = _client_ip_hash(request, settings)
    retry_after = _retry_after(
        db, settings, email=email, ip_hash=ip_hash, now=now
    )
    if retry_after is not None:
        return _email_panel(
            request,
            errors=["error.rate_limit"],
            email=email_input,
            locale=locale,
            status_code=429,
            headers={"Retry-After": str(retry_after)},
        )

    latest = _latest_unexpired_challenge_for_email(db, email, now)
    if latest is not None and latest.failed_attempts >= settings.auth_code_max_attempts:
        return _email_panel(
            request,
            errors=["error.code_attempts"],
            email=email_input,
            locale=locale,
        )
    previous = latest if latest is not None and latest.consumed_at is None else None
    challenge_id = new_id()
    code = generate_code()
    expires_at = (
        _aware(previous.expires_at)
        if previous is not None
        else now + timedelta(seconds=settings.auth_code_lifetime_seconds)
    )
    challenge = LoginChallenge(
        id=challenge_id,
        email=email,
        code_digest=code_digest(settings.auth_code_secret, challenge_id, code),
        locale=locale,
        requester_ip_hash=ip_hash,
        created_at=now,
        expires_at=expires_at,
        attempt_window_started_at=(
            _aware(previous.attempt_window_started_at) if previous else now
        ),
        failed_attempts=previous.failed_attempts if previous else 0,
    )
    try:
        await run_in_threadpool(
            request.app.state.email_sender.send_code, email, code, locale
        )
    except Exception:
        db.rollback()
        return _email_panel(
            request,
            errors=["error.email_send"],
            email=email_input,
            locale=locale,
        )
    if previous is not None:
        previous.consumed_at = now
    db.add(challenge)
    db.commit()
    return _code_panel(request, challenge)


@router.post("/auth/code/resend", name="resend_login_code")
async def resend_login_code(
    request: Request, db: Session = Depends(get_db)
) -> Response:
    settings: Settings = request.app.state.settings
    now = _now()
    _cleanup_challenges(db, settings, now)
    form = await request.form(max_fields=5, max_files=0)
    challenge_id = str(form.get("challenge_id", ""))
    challenge = db.get(LoginChallenge, challenge_id)
    if not valid_csrf(request, str(form.get("csrf_token", ""))):
        if challenge is None:
            return _email_panel(request, errors=["error.csrf"])
        return _code_panel(request, challenge, errors=["error.csrf"])
    if (
        challenge is None
        or challenge.consumed_at is not None
        or _aware(challenge.expires_at) <= now
    ):
        return _email_panel(request, errors=["error.code_expired"])
    if challenge.failed_attempts >= settings.auth_code_max_attempts:
        return _code_panel(request, challenge, errors=["error.code_attempts"])

    ip_hash = _client_ip_hash(request, settings)
    retry_after = _retry_after(
        db, settings, email=challenge.email, ip_hash=ip_hash, now=now
    )
    if retry_after is not None:
        return _code_panel(
            request,
            challenge,
            errors=["error.rate_limit"],
            status_code=429,
            headers={"Retry-After": str(retry_after)},
        )

    replacement_id = new_id()
    code = generate_code()
    replacement = LoginChallenge(
        id=replacement_id,
        email=challenge.email,
        code_digest=code_digest(
            settings.auth_code_secret, replacement_id, code
        ),
        locale=challenge.locale,
        requester_ip_hash=ip_hash,
        created_at=now,
        expires_at=_aware(challenge.expires_at),
        attempt_window_started_at=_aware(challenge.attempt_window_started_at),
        failed_attempts=challenge.failed_attempts,
    )
    try:
        await run_in_threadpool(
            request.app.state.email_sender.send_code,
            replacement.email,
            code,
            replacement.locale,
        )
    except Exception:
        db.rollback()
        return _code_panel(request, challenge, errors=["error.email_send"])
    challenge.consumed_at = now
    db.add(replacement)
    db.commit()
    return _code_panel(request, replacement, notice="auth.code.resent")


@router.post("/auth/code/verify", name="verify_login_code")
async def verify_login_code(
    request: Request, db: Session = Depends(get_db)
) -> Response:
    settings: Settings = request.app.state.settings
    now = _now()
    _cleanup_challenges(db, settings, now)
    form = await request.form(max_fields=5, max_files=0)
    challenge_id = str(form.get("challenge_id", ""))
    code = str(form.get("code", "")).strip()
    challenge = db.get(LoginChallenge, challenge_id)
    if not valid_csrf(request, str(form.get("csrf_token", ""))):
        if challenge is None:
            return _email_panel(request, errors=["error.csrf"])
        return _code_panel(request, challenge, errors=["error.csrf"])
    if (
        challenge is None
        or challenge.consumed_at is not None
        or _aware(challenge.expires_at) <= now
    ):
        return _email_panel(request, errors=["error.code_expired"])
    if challenge.failed_attempts >= settings.auth_code_max_attempts:
        challenge.consumed_at = now
        db.commit()
        return _code_panel(request, challenge, errors=["error.code_attempts"])

    valid = valid_code_format(code) and secrets.compare_digest(
        code_digest(settings.auth_code_secret, challenge.id, code),
        challenge.code_digest,
    )
    if not valid:
        next_attempts = LoginChallenge.failed_attempts + 1
        incremented = db.execute(
            update(LoginChallenge)
            .where(
                LoginChallenge.id == challenge.id,
                LoginChallenge.consumed_at.is_(None),
                LoginChallenge.expires_at > now,
                LoginChallenge.failed_attempts < settings.auth_code_max_attempts,
            )
            .values(
                failed_attempts=next_attempts,
                consumed_at=case(
                    (
                        next_attempts >= settings.auth_code_max_attempts,
                        now,
                    ),
                    else_=LoginChallenge.consumed_at,
                ),
            )
            .execution_options(synchronize_session=False)
        )
        db.commit()
        if incremented.rowcount != 1:
            return _email_panel(request, errors=["error.code_expired"])
        db.refresh(challenge)
        error = (
            "error.code_attempts"
            if challenge.failed_attempts >= settings.auth_code_max_attempts
            else "error.code_invalid"
        )
        return _code_panel(request, challenge, errors=[error])

    claimed = db.execute(
        update(LoginChallenge)
        .where(
            LoginChallenge.id == challenge.id,
            LoginChallenge.consumed_at.is_(None),
            LoginChallenge.expires_at > now,
            LoginChallenge.failed_attempts < settings.auth_code_max_attempts,
        )
        .values(consumed_at=now)
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:
        db.rollback()
        return _email_panel(request, errors=["error.code_expired"])
    user = db.scalar(select(User).where(User.email == challenge.email))
    if user is None:
        user = User(email=challenge.email, email_verified_at=now)
        db.add(user)
    elif user.email_verified_at is None:
        user.email_verified_at = now
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        user = db.scalar(select(User).where(User.email == challenge.email))
        if user is None:
            raise
        claimed = db.execute(
            update(LoginChallenge)
            .where(
                LoginChallenge.id == challenge_id,
                LoginChallenge.consumed_at.is_(None),
                LoginChallenge.expires_at > now,
                LoginChallenge.failed_attempts < settings.auth_code_max_attempts,
            )
            .values(consumed_at=now)
            .execution_options(synchronize_session=False)
        )
        if claimed.rowcount != 1:
            db.rollback()
            return _email_panel(request, errors=["error.code_expired"])
        if user.email_verified_at is None:
            user.email_verified_at = now
        db.commit()
    db.refresh(user)
    start_user_session(request, user)
    return _signed_in_response(request)


@router.post("/auth/logout", name="logout")
async def logout(request: Request) -> Response:
    form = await request.form(max_fields=2, max_files=0)
    if valid_csrf(request, str(form.get("csrf_token", ""))):
        request.session.clear()
    return RedirectResponse(request.url_for("home"), status_code=303)
