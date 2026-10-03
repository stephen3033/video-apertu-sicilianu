import { escape } from '../utils/html';
import { text, translated_attribute } from './helpers';
import { mark, language_selector } from './components';
import { type View } from './types';

export function base(v: View): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="theme-color" content="#f3f4f6">
    <title>Video Apertu Sicilianu</title>
    <link rel="icon" type="image/png" href="${escape('/static/favicon.png')}">
    <link rel="apple-touch-icon" href="${escape('/static/favicon.png')}">
    <link rel="stylesheet" href="${escape('/static/css/app.css')}">
    <script defer src="${escape('/vendor/htmx/htmx.min.js')}"></script>
    <script defer src="${escape('/static/js/app.js')}"></script>
  </head>
  <body>
    ${v.content || ''}
  </body>
</html>
`;
}
export function home(v: View): string {
  return `



<div class="public-shell">
  <header class="public-header">
    <a class="brand" href="${escape('/')}" aria-label="Video Apertu Sicilianu">
      ${mark()}
      <span class="brand__words">
        <strong>Video Apertu</strong>
        <small>Sicilianu</small>
      </span>
    </a>
    ${language_selector('public')}
  </header>

  <main class="auth-page">
    ${v.content || ''}
  </main>
</div>

`;
}
export function shell(v: View): string {
  return `



<div class="app-shell">
  <header class="app-header" data-persistent-navbar>
    <a class="brand brand--app" href="${escape('/submissions/new')}">
      ${mark()}
      <span class="brand__words">
        <strong>Video Apertu</strong>
        <small>Sicilianu</small>
      </span>
    </a>

    <nav class="app-nav" ${translated_attribute('aria.primary_navigation')}>
      <a
        href="${escape('/submissions')}"
        hx-get="${escape('/submissions')}"
        hx-target="#app-content"
        hx-swap="innerHTML show:top"
        hx-push-url="true"
        data-nav-section="history"
      >${text('nav.history')}</a>
      <a
        href="${escape('/submissions/new')}"
        hx-get="${escape('/submissions/new')}"
        hx-target="#app-content"
        hx-swap="innerHTML show:top"
        hx-push-url="true"
        data-nav-section="new"
      >${text('nav.new')}</a>
    ${v.reviewer ? reviewLink : ''}</nav>

    <div class="account-tools">
      ${language_selector('app')}
      <div class="account-identity">
        ${text('nav.account', 'span', 'sr-only')}
        <span class="account-dot" aria-hidden="true"></span>
        <span class="account-email" title="${escape(v.user!.email)}">${escape(v.user!.email)}</span>
      </div>
      <form method="post" action="${escape('/auth/logout')}">
        <input type="hidden" name="csrf_token" value="${escape(v.csrf_token)}">
        <button class="text-button" type="submit">${text('nav.logout')}</button>
      </form>
    </div>
  </header>

  <main id="app-content" class="app-content" hx-history-elt tabindex="-1">
    ${v.content || ''}
  </main>
</div>

`;
}
const reviewLink = `<a href="/review" hx-get="/review" hx-target="#app-content" hx-swap="innerHTML show:top" hx-push-url="true" data-nav-section="review">${text('nav.review')}</a>`;
export const page = (v: View, content: string, app = false) =>
  base({ ...v, content: app ? shell({ ...v, content }) : home({ ...v, content }) });
