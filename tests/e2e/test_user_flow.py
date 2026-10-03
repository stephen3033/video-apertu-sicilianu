from __future__ import annotations

import re
from uuid import uuid4

import pytest
from playwright.sync_api import Page, expect

from tests.e2e.conftest import BrowserEmailSender


pytestmark = pytest.mark.e2e


def test_multilingual_email_authentication_navigation_and_upload(
    page: Page, live_url: str, browser_email_sender: BrowserEmailSender
):
    requests: list[str] = []
    page.on("request", lambda request: requests.append(request.url))
    page.goto(live_url)

    language = page.locator("[data-language-select]").first
    request_count = len(requests)
    language.select_option("it")
    expect(page.locator("h1")).to_have_text("Accedi o crea un account")
    assert len(requests) == request_count

    email = f"browser-{uuid4().hex}@example.com"
    first_email = f"change-{uuid4().hex}@example.com"
    panel = page.locator("#auth-panel")
    panel.locator('input[name="email"]').fill(first_email)
    panel.locator('button[type="submit"]').click()
    expect(panel.locator("h1")).to_have_text("Controlla la tua email")
    expect(panel.locator('input[autocomplete="one-time-code"]')).to_be_visible()
    assert browser_email_sender.messages[-1].locale == "it"

    panel.get_by_text("Cambia email", exact=True).click()
    expect(panel.locator("h1")).to_have_text("Accedi o crea un account")
    panel.locator('input[name="email"]').fill(email)
    panel.locator('button[type="submit"]').click()
    expect(panel.locator("h1")).to_have_text("Controlla la tua email")

    page.evaluate("window.beforeAuthentication = true")
    panel.locator('input[name="code"]').fill(browser_email_sender.messages[-1].code)
    panel.get_by_role("button", name="Continua").click()

    page.wait_for_url(re.compile(r"/submissions/new$"))
    assert page.evaluate("window.beforeAuthentication") is None
    expect(page.locator("[data-language-select]").first).to_have_value("it")
    expect(page.locator("#app-content h1")).to_have_text("Carica un file")

    navbar = page.locator("[data-persistent-navbar]")
    navbar.evaluate("element => element.dataset.browserIdentity = 'preserved'")
    page.locator('[data-nav-section="history"]').click()
    page.wait_for_url(re.compile(r"/submissions$"))
    expect(navbar).to_have_attribute("data-browser-identity", "preserved")
    expect(page.locator("#app-content h1")).to_have_text("Invii precedenti")

    page.locator('[data-nav-section="new"]').click()
    page.wait_for_url(re.compile(r"/submissions/new$"))
    expect(navbar).to_have_attribute("data-browser-identity", "preserved")

    page.locator('input[name="title"]').fill("Voce da Modica")
    page.locator('textarea[name="notes"]').fill("Una breve testimonianza.")
    page.locator('input[name="media"]').set_input_files(
        {
            "name": "testimony.mp4",
            "mimeType": "video/mp4",
            "buffer": b"small browser fixture",
        }
    )
    page.locator('[data-upload-form] button[type="submit"]').click()

    success = page.locator(".success-card")
    expect(success).to_be_visible()
    expect(success.locator("h2")).to_have_text("Caricamento completato")
    expect(success.locator(".button")).to_have_count(1)
    expect(navbar).to_have_attribute("data-browser-identity", "preserved")

    page.locator('[data-nav-section="history"]').click()
    page.wait_for_url(re.compile(r"/submissions$"))
    expect(page.get_by_text("Voce da Modica", exact=True)).to_be_visible()
    expect(page.get_by_text("testimony.mp4", exact=True)).to_be_visible()

    page.go_back()
    page.wait_for_url(re.compile(r"/submissions/new$"))
    expect(navbar).to_have_attribute("data-browser-identity", "preserved")

    page.locator(".account-tools form button").click()
    page.wait_for_url(re.compile(r"/$"))
    expect(page.locator("#auth-panel h1")).to_have_text("Accedi o crea un account")
