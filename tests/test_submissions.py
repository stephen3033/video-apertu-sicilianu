from __future__ import annotations

from sqlalchemy import select

from app.models import Submission, User
from tests.conftest import csrf_token


def upload(client, *, title="A village story", filename="story.mp4", content=b"media", media_type="video/mp4"):
    token = csrf_token(client.get("/submissions/new").text)
    return client.post(
        "/submissions",
        data={"csrf_token": token, "title": title, "notes": "Recorded near Modica."},
        files={"media": (filename, content, media_type)},
        headers={"HX-Request": "true"},
    )


def test_valid_upload_uses_repository_and_appears_in_history(app, client, authenticate, repository):
    authenticate()
    response = upload(client)

    assert response.status_code == 200
    assert 'id="submission-workspace"' in response.text
    assert 'data-i18n-key="success.another"' in response.text
    assert len(repository.stored) == 1
    assert next(iter(repository.stored.values())) == b"media"

    history = client.get("/submissions", headers={"HX-Request": "true"})
    assert "A village story" in history.text
    assert "story.mp4" in history.text
    with app.state.session_factory() as db:
        submission = db.scalar(select(Submission))
        assert submission is not None
        assert submission.byte_size == 5
        assert submission.media_kind == "video"


def test_upload_rejects_unsupported_or_oversized_files(client, authenticate, repository):
    authenticate()
    unsupported = upload(client, filename="notes.txt", media_type="text/plain")
    assert 'data-i18n-key="error.file_type"' in unsupported.text

    oversized = upload(client, content=b"x" * 1025)
    assert 'data-i18n-key="error.file_size"' in oversized.text
    assert repository.stored == {}


def test_repository_failure_returns_form_without_record(app, client, authenticate, repository):
    authenticate()
    repository.fail = True
    response = upload(client)

    assert 'data-i18n-key="error.repository"' in response.text
    with app.state.session_factory() as db:
        assert db.scalar(select(Submission)) is None


def test_history_is_scoped_to_current_user(app, client, authenticate):
    authenticate("one@example.com")
    upload(client, title="First user's recording")
    client.post(
        "/auth/logout",
        data={"csrf_token": csrf_token(client.get("/submissions/new").text)},
    )
    authenticate("two@example.com")

    history = client.get("/submissions", headers={"HX-Request": "true"})
    assert "First user's recording" not in history.text
    with app.state.session_factory() as db:
        assert len(db.scalars(select(User)).all()) == 2
