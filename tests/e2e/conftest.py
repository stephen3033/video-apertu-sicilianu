from __future__ import annotations

import socket
import threading
import time
from dataclasses import dataclass, field

import pytest
import uvicorn

from app.config import Settings
from app.db import Base
from app.email import LoginCodeEmail, build_login_code_email
from app.main import create_app


@dataclass
class BrowserEmailSender:
    messages: list[LoginCodeEmail] = field(default_factory=list)

    def send_code(self, to_email: str, code: str, locale: str) -> None:
        self.messages.append(build_login_code_email(to_email, code, locale))


@pytest.fixture(scope="session")
def browser_email_sender() -> BrowserEmailSender:
    return BrowserEmailSender()


@pytest.fixture(scope="session")
def live_url(tmp_path_factory, browser_email_sender: BrowserEmailSender) -> str:
    root = tmp_path_factory.mktemp("browser-app")
    settings = Settings(
        database_url=f"sqlite:///{root / 'browser.db'}",
        session_secret="browser-test-secret-with-sufficient-length",
        storage_root=root / "uploads",
        max_upload_bytes=1024 * 1024,
        auth_code_secret="browser-test-authentication-code-secret",
    )
    application = create_app(settings=settings, email_sender=browser_email_sender)
    Base.metadata.create_all(application.state.engine)

    listening_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listening_socket.bind(("127.0.0.1", 0))
    host, port = listening_socket.getsockname()
    server = uvicorn.Server(
        uvicorn.Config(application, host=host, port=port, log_level="error")
    )
    thread = threading.Thread(
        target=server.run,
        kwargs={"sockets": [listening_socket]},
        daemon=True,
    )
    thread.start()
    deadline = time.monotonic() + 10
    while not server.started and time.monotonic() < deadline:
        time.sleep(0.01)
    if not server.started:
        raise RuntimeError("Browser test server did not start")

    yield f"http://{host}:{port}"

    server.should_exit = True
    thread.join(timeout=10)
    application.state.engine.dispose()
