from __future__ import annotations

import secrets
import time

from email_validator import EmailNotValidError, validate_email
from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.config import Settings
from app.db import get_db
from app.models import User


CSRF_SESSION_KEY = "csrf_token"
AUTHENTICATED_AT_SESSION_KEY = "authenticated_at"


class AuthenticationRequired(Exception):
    pass


def normalize_email(value: str) -> str:
    try:
        return validate_email(value.strip(), check_deliverability=False).normalized.casefold()
    except EmailNotValidError as exc:
        raise ValueError("Invalid email") from exc


def get_csrf_token(request: Request) -> str:
    token = request.session.get(CSRF_SESSION_KEY)
    if not token:
        token = secrets.token_urlsafe(32)
        request.session[CSRF_SESSION_KEY] = token
    return token


def valid_csrf(request: Request, submitted: str) -> bool:
    expected = request.session.get(CSRF_SESSION_KEY, "")
    return bool(expected and submitted and secrets.compare_digest(expected, submitted))


def start_user_session(request: Request, user: User) -> None:
    request.session.clear()
    request.session["user_id"] = user.id
    request.session[AUTHENTICATED_AT_SESSION_KEY] = int(time.time())
    get_csrf_token(request)


def session_user(request: Request, db: Session) -> User | None:
    user_id = request.session.get("user_id")
    authenticated_at = request.session.get(AUTHENTICATED_AT_SESSION_KEY)
    settings: Settings = request.app.state.settings
    try:
        session_age = time.time() - float(authenticated_at)
    except (TypeError, ValueError):
        session_age = settings.authenticated_session_lifetime_seconds
    if session_age < 0 or session_age >= settings.authenticated_session_lifetime_seconds:
        request.session.clear()
        return None
    user = db.get(User, user_id) if user_id else None
    if user is None:
        request.session.clear()
        return None
    return user


def require_user(request: Request, db: Session = Depends(get_db)) -> User:
    user = session_user(request, db)
    if user is None:
        raise AuthenticationRequired
    return user
