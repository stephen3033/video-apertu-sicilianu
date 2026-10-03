from __future__ import annotations

import re
from collections.abc import Iterator
from dataclasses import dataclass, field

import pytest
from fastapi.testclient import TestClient
from starlette.datastructures import UploadFile

from app.config import Settings
from app.db import Base
from app.email import LoginCodeEmail, build_login_code_email
from app.main import create_app
from app.repositories import EmptyMediaError, MediaTooLargeError, RepositoryError, StoredMedia


@dataclass
class FakeMediaRepository:
    fail: bool = False
    stored: dict[str, bytes] = field(default_factory=dict)
    deleted: list[str] = field(default_factory=list)

    async def store(self, upload: UploadFile, *, key: str, max_bytes: int) -> StoredMedia:
        if self.fail:
            raise RepositoryError("test failure")
        content = await upload.read()
        await upload.close()
        if not content:
            raise EmptyMediaError
        if len(content) > max_bytes:
            raise MediaTooLargeError
        self.stored[key] = content
        return StoredMedia(reference=key, byte_size=len(content))

    async def delete(self, reference: str) -> None:
        self.deleted.append(reference)
        self.stored.pop(reference, None)


@dataclass
class FakeEmailSender:
    messages: list[LoginCodeEmail] = field(default_factory=list)

    def send_code(self, to_email: str, code: str, locale: str) -> None:
        self.messages.append(build_login_code_email(to_email, code, locale))


@pytest.fixture
def repository() -> FakeMediaRepository:
    return FakeMediaRepository()


@pytest.fixture
def email_sender() -> FakeEmailSender:
    return FakeEmailSender()


@pytest.fixture
def app(tmp_path, repository: FakeMediaRepository, email_sender: FakeEmailSender):
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        session_secret="a-long-test-secret-that-is-not-used-in-production",
        storage_root=tmp_path / "uploads",
        max_upload_bytes=1024,
        auth_code_secret="a-distinct-test-authentication-code-secret",
    )
    application = create_app(
        settings=settings,
        media_repository=repository,
        email_sender=email_sender,
    )
    Base.metadata.create_all(application.state.engine)
    yield application
    application.state.engine.dispose()


@pytest.fixture
def client(app) -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


def csrf_token(html: str) -> str:
    match = re.search(r'name="csrf_token" value="([^"]+)"', html)
    assert match, "CSRF token not found"
    return match.group(1)


def challenge_id(html: str) -> str:
    match = re.search(r'name="challenge_id" value="([^"]+)"', html)
    assert match, "Challenge ID not found"
    return match.group(1)


def request_code(client: TestClient, email: str, *, locale: str = "en"):
    token = csrf_token(client.get("/").text)
    return client.post(
        "/auth/code/request",
        data={"csrf_token": token, "email": email, "locale": locale},
        headers={"HX-Request": "true"},
    )


def verify_code(client: TestClient, html: str, code: str):
    return client.post(
        "/auth/code/verify",
        data={
            "csrf_token": csrf_token(html),
            "challenge_id": challenge_id(html),
            "code": code,
        },
        headers={"HX-Request": "true"},
    )


@pytest.fixture
def authenticate(client: TestClient):
    def _authenticate(email: str = "speaker@example.com"):
        requested = request_code(client, email)
        sender: FakeEmailSender = client.app.state.email_sender
        return verify_code(client, requested.text, sender.messages[-1].code)

    return _authenticate
