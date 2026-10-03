import { escape } from '../utils/html';
import { text, errors, translated_attribute } from './helpers';
import { type View } from './types';

export function emailCard(v: View): string {
  return `
<section class="auth-panel" id="auth-panel" ${translated_attribute('aria.account_access')}>
  ${text('auth.title', 'h1')}
  ${text('auth.intro', 'p', 'card-intro')}
  ${errors(v.auth_errors)}
  <form
    method="post"
    action="${escape('/auth/code/request')}"
    hx-post="${escape('/auth/code/request')}"
    hx-target="#auth-panel"
    hx-swap="outerHTML"
    hx-disabled-elt="find button"
  >
    <input type="hidden" name="csrf_token" value="${escape(v.csrf_token)}">
    <input type="hidden" name="locale" value="${escape(v.auth_locale)}" data-auth-locale>
    <label class="field">
      ${text('auth.email')}
      <input name="email" type="email" value="${escape(v.auth_email)}" autocomplete="email" required maxlength="320" autofocus>
    </label>
    <button class="button button--primary button--wide" type="submit">
      ${text('auth.email.action')}
      <span aria-hidden="true">→</span>
    </button>
  </form>
</section>
`;
}
export function codeCard(v: View): string {
  return `
<section class="auth-panel" id="auth-panel" ${translated_attribute('aria.account_access')}>
  ${text('auth.code.title', 'h1')}
  <p class="card-intro">
    ${text('auth.code.sent')}
    <strong class="masked-email">${escape(v.masked_email)}</strong>
  </p>
  ${
    v.auth_notice
      ? `
    <p class="form-notice" role="status">${text(v.auth_notice)}</p>
  `
      : ``
  }
  ${errors(v.auth_errors)}
  <form
    method="post"
    action="${escape('/auth/code/verify')}"
    hx-post="${escape('/auth/code/verify')}"
    hx-target="#auth-panel"
    hx-swap="outerHTML"
    hx-disabled-elt="find button"
  >
    <input type="hidden" name="csrf_token" value="${escape(v.csrf_token)}">
    <input type="hidden" name="challenge_id" value="${escape(v.challenge_id)}">
    <input type="hidden" name="locale" value="${escape(v.auth_locale)}" data-auth-locale>
    <label class="field">
      ${text('auth.code')}
      <input class="code-input" name="code" type="text" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="one-time-code" required autofocus>
      ${text('auth.code.help', 'small', 'field-help')}
    </label>
    <button class="button button--primary button--wide" type="submit">
      ${text('auth.verify.action')}
      <span aria-hidden="true">→</span>
    </button>
  </form>
  <div class="auth-alternatives">
    <form
      method="post"
      action="${escape('/auth/code/resend')}"
      hx-post="${escape('/auth/code/resend')}"
      hx-target="#auth-panel"
      hx-swap="outerHTML"
      hx-disabled-elt="find button"
    >
      <input type="hidden" name="csrf_token" value="${escape(v.csrf_token)}">
      <input type="hidden" name="challenge_id" value="${escape(v.challenge_id)}">
      <button class="text-button" type="submit">${text('auth.resend')}</button>
    </form>
    <a
      class="text-link"
      href="${escape('/')}"
      hx-get="${escape('/auth/email')}"
      hx-target="#auth-panel"
      hx-swap="outerHTML"
    >${text('auth.change_email')}</a>
  </div>
</section>
`;
}
