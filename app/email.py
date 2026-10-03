from __future__ import annotations

import html
import smtplib
from dataclasses import dataclass, field
from email.message import EmailMessage
from typing import Protocol

from app.config import Settings


@dataclass(frozen=True)
class LoginCodeEmail:
    to_email: str
    code: str
    locale: str
    subject: str
    text_body: str
    html_body: str


class EmailSender(Protocol):
    def send_code(self, to_email: str, code: str, locale: str) -> None: ...


EMAIL_COPY = {
    "en": {
        "subject": "Your Video Apertu sign-in code",
        "heading": "Your sign-in code",
        "intro": "Use this code to sign in to or create your Video Apertu Sicilianu account:",
        "expiry": "This code expires in 10 minutes and can only be used once.",
        "ignore": "If you did not request this code, you can ignore this email.",
    },
    "scn": {
        "subject": "Lu tò còdici pi tràsiri nta Video Apertu",
        "heading": "Lu tò còdici pi tràsiri",
        "intro": "Aḍḍòpira stu còdici pi tràsiri o criari lu tò cuntu Video Apertu Sicilianu:",
        "expiry": "Stu còdici scadi tra 10 minuti e si po usari na vota sula.",
        "ignore": "Si nun addumannasti stu còdici, poi lassari pèrdiri sta email.",
    },
    "it": {
        "subject": "Il tuo codice di accesso a Video Apertu",
        "heading": "Il tuo codice di accesso",
        "intro": "Usa questo codice per accedere o creare il tuo account Video Apertu Sicilianu:",
        "expiry": "Questo codice scade tra 10 minuti e può essere usato una sola volta.",
        "ignore": "Se non hai richiesto questo codice, puoi ignorare questa email.",
    },
}


def build_login_code_email(to_email: str, code: str, locale: str) -> LoginCodeEmail:
    locale = locale if locale in EMAIL_COPY else "en"
    copy = EMAIL_COPY[locale]
    text_body = f"{copy['heading']}\n\n{copy['intro']}\n\n{code}\n\n{copy['expiry']}\n{copy['ignore']}\n"
    html_body = (
        "<!doctype html><html><body>"
        f"<h1>{html.escape(copy['heading'])}</h1>"
        f"<p>{html.escape(copy['intro'])}</p>"
        f'<p style="font-size:2rem;font-weight:bold;letter-spacing:.25em">{html.escape(code)}</p>'
        f"<p>{html.escape(copy['expiry'])}</p>"
        f"<p>{html.escape(copy['ignore'])}</p>"
        "</body></html>"
    )
    return LoginCodeEmail(
        to_email=to_email,
        code=code,
        locale=locale,
        subject=copy["subject"],
        text_body=text_body,
        html_body=html_body,
    )


@dataclass
class ConsoleEmailSender:
    messages: list[LoginCodeEmail] = field(default_factory=list)

    def send_code(self, to_email: str, code: str, locale: str) -> None:
        message = build_login_code_email(to_email, code, locale)
        self.messages.append(message)
        print(
            f"[login-code] to={message.to_email} locale={message.locale} code={message.code}",
            flush=True,
        )


@dataclass
class SMTPEmailSender:
    host: str
    port: int
    starttls: bool
    username: str | None
    password: str | None
    sender_address: str
    timeout_seconds: int = 10

    def send_code(self, to_email: str, code: str, locale: str) -> None:
        content = build_login_code_email(to_email, code, locale)
        message = EmailMessage()
        message["To"] = content.to_email
        message["From"] = self.sender_address
        message["Subject"] = content.subject
        message.set_content(content.text_body)
        message.add_alternative(content.html_body, subtype="html")
        with smtplib.SMTP(self.host, self.port, timeout=self.timeout_seconds) as smtp:
            smtp.ehlo()
            if self.starttls:
                smtp.starttls()
                smtp.ehlo()
            if self.username and self.password:
                smtp.login(self.username, self.password)
            smtp.send_message(message)


def build_email_sender(settings: Settings) -> EmailSender:
    if settings.email_backend == "console":
        return ConsoleEmailSender()
    return SMTPEmailSender(
        host=settings.smtp_host or "",
        port=settings.smtp_port,
        starttls=settings.smtp_starttls,
        username=settings.smtp_username or None,
        password=settings.smtp_password or None,
        sender_address=settings.email_sender_address or "",
        timeout_seconds=settings.smtp_timeout_seconds,
    )
