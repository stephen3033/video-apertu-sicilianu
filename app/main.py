from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
from starlette.responses import RedirectResponse, Response
from starlette.templating import Jinja2Templates

from app.config import PROJECT_ROOT, Settings, get_settings
from app.db import build_engine, build_session_factory
from app.email import EmailSender, build_email_sender
from app.repositories.base import MediaRepository
from app.repositories.factory import build_media_repository
from app.routes import auth, submissions
from app.security import AuthenticationRequired


def create_app(
    settings: Settings | None = None,
    media_repository: MediaRepository | None = None,
    email_sender: EmailSender | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="Video Apertu Sicilianu")
    app.state.settings = settings
    app.state.engine = build_engine(settings.database_url)
    app.state.session_factory = build_session_factory(app.state.engine)
    app.state.media_repository = media_repository or build_media_repository(settings)
    app.state.email_sender = email_sender or build_email_sender(settings)
    app.state.templates = Jinja2Templates(directory=PROJECT_ROOT / "app" / "templates")

    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.session_secret,
        session_cookie="vas_session",
        same_site="lax",
        https_only=settings.cookie_secure,
        max_age=None,
    )

    app.mount(
        "/static",
        StaticFiles(directory=PROJECT_ROOT / "app" / "static"),
        name="static",
    )
    htmx_directory = PROJECT_ROOT / "node_modules" / "htmx.org" / "dist"
    app.mount(
        "/vendor/htmx",
        StaticFiles(directory=htmx_directory, check_dir=False),
        name="htmx",
    )

    @app.exception_handler(AuthenticationRequired)
    async def authentication_required(request: Request, _: AuthenticationRequired) -> Response:
        destination = str(request.url_for("home"))
        if request.headers.get("HX-Request", "").lower() == "true":
            return Response(status_code=401, headers={"HX-Redirect": destination})
        return RedirectResponse(destination, status_code=303)

    app.include_router(auth.router)
    app.include_router(submissions.router)
    return app


app = create_app()
