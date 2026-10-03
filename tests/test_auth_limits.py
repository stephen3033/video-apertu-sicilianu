from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models import LoginChallenge
from tests.conftest import request_code


def test_three_email_sends_in_fifteen_minutes_are_allowed_then_limited(
    app, client, email_sender
):
    app.state.settings.auth_code_resend_cooldown_seconds = 0
    for _ in range(3):
        assert request_code(client, "speaker@example.com").status_code == 200

    limited = request_code(client, "speaker@example.com", locale="scn")

    assert limited.status_code == 429
    assert int(limited.headers["Retry-After"]) > 0
    assert 'data-i18n-key="error.rate_limit"' in limited.text
    assert "data-i18n-scn=" in limited.text
    assert len(email_sender.messages) == 3


def test_hashed_ip_send_limit_applies_across_addresses(app, client, email_sender):
    app.state.settings.auth_code_resend_cooldown_seconds = 0
    app.state.settings.auth_code_ip_limit = 2
    app.state.settings.auth_code_email_limit = 10
    assert request_code(client, "one@example.com").status_code == 200
    assert request_code(client, "two@example.com").status_code == 200

    limited = request_code(client, "three@example.com")

    assert limited.status_code == 429
    assert len(email_sender.messages) == 2
    with app.state.session_factory() as db:
        challenges = db.scalars(select(LoginChallenge)).all()
        assert len(challenges) == 2
        assert len({item.requester_ip_hash for item in challenges}) == 1
        assert challenges[0].requester_ip_hash != "testclient"


def test_challenges_older_than_retention_are_cleaned_up(app, client):
    old = datetime.now(timezone.utc) - timedelta(hours=25)
    with app.state.session_factory() as db:
        db.add(
            LoginChallenge(
                email="old@example.com",
                code_digest="0" * 64,
                locale="en",
                requester_ip_hash="1" * 64,
                created_at=old,
                expires_at=old + timedelta(minutes=10),
                attempt_window_started_at=old,
            )
        )
        db.commit()

    client.get("/auth/email", headers={"HX-Request": "true"})

    with app.state.session_factory() as db:
        assert db.scalar(select(LoginChallenge)) is None


def test_authenticated_session_has_absolute_server_side_expiry(
    app, client, authenticate
):
    authenticate()
    assert client.get("/submissions/new").status_code == 200
    assert app.state.settings.authenticated_session_lifetime_seconds == 12 * 60 * 60

    app.state.settings.authenticated_session_lifetime_seconds = 0
    expired = client.get("/submissions/new", follow_redirects=False)

    assert expired.status_code == 303
    assert expired.headers["location"] == "http://testserver/"
