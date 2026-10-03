from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.config import Settings
from app.email import ConsoleEmailSender, SMTPEmailSender, build_login_code_email


def test_login_email_is_localized_in_plain_text_and_html():
    italian = build_login_code_email("voice@example.com", "012345", "it")
    sicilian = build_login_code_email("voice@example.com", "654321", "scn")

    assert "codice" in italian.subject.casefold()
    assert "012345" in italian.text_body
    assert "012345" in italian.html_body
    assert "còdici" in sicilian.subject.casefold()
    assert sicilian.locale == "scn"


def test_console_sender_captures_and_prints_code(capsys):
    sender = ConsoleEmailSender()
    sender.send_code("voice@example.com", "012345", "en")

    assert sender.messages[0].code == "012345"
    assert "012345" in capsys.readouterr().out


def test_smtp_sender_uses_starttls_login_and_multipart_message(monkeypatch):
    calls: list[object] = []

    class FakeSMTP:
        def __init__(self, host, port, timeout):
            calls.append((host, port, timeout))

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def ehlo(self):
            calls.append("ehlo")

        def starttls(self):
            calls.append("starttls")

        def login(self, username, password):
            calls.append(("login", username, password))

        def send_message(self, message):
            calls.append(message)

    monkeypatch.setattr("app.email.smtplib.SMTP", FakeSMTP)
    sender = SMTPEmailSender(
        host="smtp.example.com",
        port=587,
        starttls=True,
        username="mailer",
        password="secret",
        sender_address="archive@example.com",
    )
    sender.send_code("voice@example.com", "012345", "en")

    assert calls[:4] == [
        ("smtp.example.com", 587, 10),
        "ehlo",
        "starttls",
        "ehlo",
    ]
    assert calls[4] == ("login", "mailer", "secret")
    message = calls[5]
    assert message["To"] == "voice@example.com"
    assert message["From"] == "archive@example.com"
    assert message.is_multipart()


def test_smtp_sender_supports_unauthenticated_local_server(monkeypatch):
    calls: list[str] = []

    class FakeLocalSMTP:
        def __init__(self, _host, _port, timeout):
            assert timeout == 10

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def ehlo(self):
            calls.append("ehlo")

        def starttls(self):
            raise AssertionError("STARTTLS should be disabled for local Mailpit")

        def login(self, _username, _password):
            raise AssertionError("Unauthenticated SMTP should not call login")

        def send_message(self, _message):
            calls.append("sent")

    monkeypatch.setattr("app.email.smtplib.SMTP", FakeLocalSMTP)
    sender = SMTPEmailSender(
        host="127.0.0.1",
        port=1025,
        starttls=False,
        username=None,
        password=None,
        sender_address="noreply@example.test",
    )
    sender.send_code("voice@example.com", "012345", "en")

    assert calls == ["ehlo", "sent"]


def test_smtp_settings_fail_early_when_required_values_are_missing():
    with pytest.raises(ValidationError, match="smtp_host"):
        Settings(email_backend="smtp", _env_file=None)


def test_smtp_credentials_must_be_configured_as_a_pair():
    with pytest.raises(ValidationError, match="both be set"):
        Settings(
            email_backend="smtp",
            email_sender_address="noreply@example.test",
            smtp_host="127.0.0.1",
            smtp_username="user",
            _env_file=None,
        )
