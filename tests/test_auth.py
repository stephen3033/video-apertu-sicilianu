from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.auth_codes import code_digest
from app.models import LoginChallenge, User
from tests.conftest import challenge_id, csrf_token, request_code, verify_code


def test_code_request_creates_no_user_and_returns_verification_panel(
    app, client, email_sender
):
    response = request_code(client, "VOICE@Example.com", locale="it")

    assert response.status_code == 200
    assert response.text.count('id="auth-panel"') == 1
    assert 'autocomplete="one-time-code"' in response.text
    assert "v***@example.com" in response.text
    assert "voice@example.com" not in response.text
    assert email_sender.messages[-1].locale == "it"
    assert email_sender.messages[-1].code in email_sender.messages[-1].text_body
    assert email_sender.messages[-1].code in email_sender.messages[-1].html_body
    with app.state.session_factory() as db:
        assert db.scalar(select(User)) is None
        challenge = db.scalar(select(LoginChallenge))
        assert challenge is not None
        assert challenge.email == "voice@example.com"
        assert challenge.code_digest != email_sender.messages[-1].code
        assert challenge.code_digest == code_digest(
            app.state.settings.auth_code_secret,
            challenge.id,
            email_sender.messages[-1].code,
        )


def test_valid_code_creates_verified_user_and_uses_session_cookie(
    app, client, email_sender
):
    requested = request_code(client, "VOICE@Example.com")
    response = verify_code(client, requested.text, email_sender.messages[-1].code)

    assert response.status_code == 204
    assert response.headers["HX-Redirect"].endswith("/submissions/new")
    assert "Max-Age" not in response.headers["set-cookie"]
    with app.state.session_factory() as db:
        user = db.scalar(select(User))
        assert user is not None
        assert user.email == "voice@example.com"
        assert user.email_verified_at is not None


def test_existing_user_is_reused_and_code_can_only_be_used_once(
    app, client, authenticate, email_sender
):
    authenticate("voice@example.com")
    with app.state.session_factory() as db:
        first_user_id = db.scalar(select(User.id))
    page = client.get("/submissions/new")
    client.post("/auth/logout", data={"csrf_token": csrf_token(page.text)})
    app.state.settings.auth_code_resend_cooldown_seconds = 0

    requested = request_code(client, "VOICE@example.com")
    code = email_sender.messages[-1].code
    verified = verify_code(client, requested.text, code)
    authenticated_page = client.get("/submissions/new")
    replayed = client.post(
        "/auth/code/verify",
        data={
            "csrf_token": csrf_token(authenticated_page.text),
            "challenge_id": challenge_id(requested.text),
            "code": code,
        },
        headers={"HX-Request": "true"},
    )

    assert verified.status_code == 204
    assert 'data-i18n-key="error.code_expired"' in replayed.text
    with app.state.session_factory() as db:
        users = db.scalars(select(User)).all()
        assert len(users) == 1
        assert users[0].id == first_user_id


def test_malformed_and_incorrect_codes_exhaust_five_attempts(
    app, client, email_sender
):
    requested = request_code(client, "speaker@example.com")
    wrong_codes = ["bad", "000000", "111111", "222222", "333333"]
    if email_sender.messages[-1].code in wrong_codes:
        wrong_codes[-1] = "444444"

    response = requested
    for index, code in enumerate(wrong_codes):
        response = verify_code(client, response.text, code)
        expected = "error.code_attempts" if index == 4 else "error.code_invalid"
        assert f'data-i18n-key="{expected}"' in response.text

    valid_after_exhaustion = verify_code(
        client, response.text, email_sender.messages[-1].code
    )
    assert 'data-i18n-key="error.code_expired"' in valid_after_exhaustion.text
    app.state.settings.auth_code_resend_cooldown_seconds = 0
    replacement = request_code(client, "speaker@example.com")
    assert 'data-i18n-key="error.code_attempts"' in replacement.text
    assert len(email_sender.messages) == 1
    with app.state.session_factory() as db:
        assert db.scalar(select(User)) is None


def test_expired_code_is_rejected(app, client, email_sender):
    requested = request_code(client, "speaker@example.com")
    with app.state.session_factory() as db:
        challenge = db.get(LoginChallenge, challenge_id(requested.text))
        assert challenge is not None
        challenge.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()

    response = verify_code(client, requested.text, email_sender.messages[-1].code)

    assert 'data-i18n-key="error.code_expired"' in response.text


def test_resend_honors_cooldown_then_invalidates_old_code(
    app, client, email_sender
):
    requested = request_code(client, "speaker@example.com")
    old_code = email_sender.messages[-1].code
    old_id = challenge_id(requested.text)
    limited = client.post(
        "/auth/code/resend",
        data={"csrf_token": csrf_token(requested.text), "challenge_id": old_id},
        headers={"HX-Request": "true"},
    )
    assert limited.status_code == 429
    assert int(limited.headers["Retry-After"]) > 0

    app.state.settings.auth_code_resend_cooldown_seconds = 0
    resent = client.post(
        "/auth/code/resend",
        data={"csrf_token": csrf_token(limited.text), "challenge_id": old_id},
        headers={"HX-Request": "true"},
    )
    assert resent.status_code == 200
    assert 'data-i18n-key="auth.code.resent"' in resent.text
    assert challenge_id(resent.text) != old_id

    old = verify_code(client, requested.text, old_code)
    assert 'data-i18n-key="error.code_expired"' in old.text
    new = verify_code(client, resent.text, email_sender.messages[-1].code)
    assert new.status_code == 204


def test_failed_attempt_count_survives_resend(app, client, email_sender):
    app.state.settings.auth_code_resend_cooldown_seconds = 0
    requested = request_code(client, "speaker@example.com")
    response = requested
    for code in ("000000", "111111", "222222", "333333"):
        if code == email_sender.messages[-1].code:
            code = "444444"
        response = verify_code(client, response.text, code)
    resent = client.post(
        "/auth/code/resend",
        data={
            "csrf_token": csrf_token(response.text),
            "challenge_id": challenge_id(response.text),
        },
        headers={"HX-Request": "true"},
    )
    fifth = verify_code(client, resent.text, "999999")

    assert 'data-i18n-key="error.code_attempts"' in fifth.text


def test_email_entry_fragment_and_validation_are_password_free(client):
    response = client.get("/auth/email", headers={"HX-Request": "true"})
    assert response.status_code == 200
    assert response.text.count('id="auth-panel"') == 1
    assert 'data-i18n-key="auth.title"' in response.text
    assert "password" not in response.text.casefold()

    invalid = client.post(
        "/auth/code/request",
        data={"csrf_token": csrf_token(response.text), "email": "not-an-email"},
        headers={"HX-Request": "true"},
    )
    assert 'data-i18n-key="error.email"' in invalid.text


def test_csrf_failure_does_not_send_code(client, email_sender):
    response = client.post(
        "/auth/code/request",
        data={"csrf_token": "invalid", "email": "speaker@example.com"},
        headers={"HX-Request": "true"},
    )
    assert 'data-i18n-key="error.csrf"' in response.text
    assert email_sender.messages == []
