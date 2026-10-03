from __future__ import annotations


def test_favicon_is_linked_and_served_as_png(client):
    page = client.get("/")
    favicon = client.get("/static/favicon.png")

    assert 'rel="icon" type="image/png"' in page.text
    assert 'href="http://testserver/static/favicon.png"' in page.text
    assert favicon.status_code == 200
    assert favicon.headers["content-type"] == "image/png"
    assert favicon.content.startswith(b"\x89PNG\r\n\x1a\n")


def test_direct_authenticated_page_contains_shell(client, authenticate):
    authenticate()
    response = client.get("/submissions/new")

    assert response.status_code == 200
    assert "data-persistent-navbar" in response.text
    assert 'id="app-content"' in response.text
    assert 'data-section="new"' in response.text


def test_htmx_navigation_returns_only_page_content(client, authenticate):
    authenticate()
    response = client.get("/submissions", headers={"HX-Request": "true"})

    assert response.status_code == 200
    assert 'data-section="history"' in response.text
    assert "data-persistent-navbar" not in response.text
    assert 'id="app-content"' not in response.text


def test_expired_htmx_session_forces_full_redirect(client):
    response = client.get("/submissions", headers={"HX-Request": "true"})

    assert response.status_code == 401
    assert response.headers["HX-Redirect"] == "http://testserver/"


def test_every_fragment_contains_all_three_languages(client, authenticate):
    authenticate()
    for path in ("/submissions", "/submissions/new"):
        response = client.get(path, headers={"HX-Request": "true"})
        assert "data-i18n-en=" in response.text
        assert "data-i18n-scn=" in response.text
        assert "data-i18n-it=" in response.text
