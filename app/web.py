from __future__ import annotations

from typing import Any

from fastapi import Request
from starlette.responses import Response

from app.i18n import TRANSLATIONS
from app.security import get_csrf_token


def is_htmx(request: Request) -> bool:
    return request.headers.get("HX-Request", "").lower() == "true"


def template_context(request: Request, **values: Any) -> dict[str, Any]:
    return {
        "request": request,
        "translations": TRANSLATIONS,
        "csrf_token": get_csrf_token(request),
        **values,
    }


def render_template(
    request: Request,
    name: str,
    *,
    status_code: int = 200,
    headers: dict[str, str] | None = None,
    **values: Any,
) -> Response:
    return request.app.state.templates.TemplateResponse(
        request=request,
        name=name,
        context=template_context(request, **values),
        status_code=status_code,
        headers=headers,
    )
