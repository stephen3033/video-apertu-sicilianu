import type { Handler } from 'hono';
import isEmail from 'validator/lib/isEmail';
import { domainToASCII } from 'node:url';
import { type App, type Ctx } from '../runtime/context';
import { type Challenge } from '../domain/models';
import { iso, now } from '../utils/time';
import { sql } from '../infrastructure/database/query';
import { cookie } from '../http/middleware/sessions';
import { field, htmx, redirect } from '../http/requests';
import { hmac, loginCode, randomToken, sha256 } from '../utils/crypto';
import { validCsrf } from '../http/middleware/guards';
import { codeCard, emailCard } from '../views/auth';
import { page } from '../views/layouts';
import { type View } from '../views/types';
import { sendCode } from '../infrastructure/email/delivery';
const view = (c: Ctx, values: Partial<View> = {}) => ({
  csrf_token: c.get('session').csrf_token,
  auth_locale: 'en',
  ...values,
});
function panel(
  c: Ctx,
  challenge?: Challenge | null,
  errors: string[] = [],
  status: 200 | 429 = 200,
  extra: Partial<View> = {},
) {
  const v = view(c, {
    auth_errors: errors,
    ...extra,
    ...(challenge
      ? {
          challenge_id: challenge.id,
          masked_email: challenge.email.replace(/^(.).*@/, '$1***@'),
          auth_locale: challenge.locale,
        }
      : {}),
  });
  const content = challenge ? codeCard(v) : emailCard(v);
  return c.html(htmx(c) ? content : page(v, content), status);
}
export const authHome: Handler<App> = (c) => c.get('user') ? c.redirect('/submissions/new', 303) : panel(c);
export const emailEntry: Handler<App> = (c) => c.get('user') ? redirect(c, '/submissions/new') : htmx(c) ? panel(c) : c.redirect('/', 303);
function normalizeEmail(value: string) {
  const at = value.lastIndexOf('@');
  const email = (value.slice(0, at) + '@' + domainToASCII(value.slice(at + 1)))
    .normalize('NFC')
    .toLowerCase();
  return at > 0 &&
    isEmail(email, { allow_utf8_local_part: true, require_tld: true }) &&
    email.length <= 320
    ? email
    : null;
}
export const handleCode: Handler<App> = async (c) => {
  const action = c.req.param('action')!;
  if (!['request', 'resend', 'verify'].includes(action)) return c.notFound();
  const id = field(c, 'challenge_id');
  const previous = id
    ? await sql(c.env, 'SELECT * FROM login_challenges WHERE id=?', id).first<Challenge>()
    : null;
  if (!validCsrf(c)) return panel(c, previous, ['error.csrf']);
  const time = now();
  const date = iso(time);
  if (action === 'verify') {
    if (!previous || previous.expires_at <= date || previous.consumed_at)
      return panel(c, null, ['error.code_expired']);
    const digest = await hmac(c.env.AUTH_CODE_SECRET, `code:${id}:${field(c, 'code')}`);
    const token = randomToken(),
      hash = await sha256(token),
      csrfToken = randomToken(),
      claim = randomToken();
    // Each dependent write is conditioned on this invocation's unique claim inside a D1 transaction.
    const result = await c.env.DB.batch([
      sql(
        c.env,
        `UPDATE login_challenges SET consumed_at=?,verification_token=? WHERE id=? AND code_digest=? AND consumed_at IS NULL AND expires_at>? AND failed_attempts<5`,
        date,
        claim,
        id,
        digest,
        date,
      ),
      sql(
        c.env,
        `INSERT INTO users(id,email,email_verified_at,created_at) SELECT ?,email,?,? FROM login_challenges WHERE id=? AND verification_token=? ON CONFLICT(email) DO UPDATE SET email_verified_at=COALESCE(users.email_verified_at,excluded.email_verified_at)`,
        crypto.randomUUID(),
        date,
        date,
        id,
        claim,
      ),
      sql(
        c.env,
        `INSERT INTO sessions(token_hash,csrf_token,user_id,authenticated_at,expires_at,created_at) SELECT ?,?,u.id,?,?,? FROM users u JOIN login_challenges ch ON ch.email=u.email WHERE ch.id=? AND ch.verification_token=?`,
        hash,
        csrfToken,
        time,
        time + 43200,
        time,
        id,
        claim,
      ),
      sql(
        c.env,
        `DELETE FROM sessions WHERE token_hash=? AND EXISTS(SELECT 1 FROM login_challenges WHERE id=? AND verification_token=?)`,
        c.get('session').token_hash,
        id,
        claim,
      ),
      sql(
        c.env,
        `UPDATE login_challenges SET failed_attempts=failed_attempts+1 WHERE id=? AND code_digest<>? AND consumed_at IS NULL AND expires_at>? AND failed_attempts<5`,
        id,
        digest,
        date,
      ),
    ]);
    if (result[0].meta.changes === 1) {
      cookie(c, token);
      return redirect(c, '/submissions/new');
    }
    const current = await sql(
      c.env,
      'SELECT * FROM login_challenges WHERE id=?',
      id,
    ).first<Challenge>();
    return panel(c, current, [
      current && current.failed_attempts >= 5
        ? 'error.code_attempts'
        : current?.consumed_at
          ? 'error.code_expired'
          : 'error.code_invalid',
    ]);
  }
  if (action === 'resend' && (!previous || previous.consumed_at || previous.expires_at <= date))
    return panel(c, null, ['error.code_expired']);
  const email = action === 'resend' ? previous!.email : normalizeEmail(field(c, 'email'));
  const locale =
    action === 'resend'
      ? previous!.locale
      : ['en', 'scn', 'it'].includes(field(c, 'locale'))
        ? field(c, 'locale')
        : 'en';
  if (!email)
    return panel(c, null, ['error.email'], 200, {
      auth_email: field(c, 'email'),
      auth_locale: locale,
    });
  const address = c.env.APP_ENV === 'local' ? 'local' : c.req.header('CF-Connecting-IP');
  if (!address) return c.text('Client address unavailable', 503);
  const ip = await hmac(c.env.AUTH_CODE_SECRET, `ip:${address}`);
  const challengeId = crypto.randomUUID(),
    code = loginCode();
  const digest = await hmac(c.env.AUTH_CODE_SECRET, `code:${challengeId}:${code}`);
  // Rate limits, inherited attempts/expiry and predecessor invalidation share one transaction.
  const inserted = await c.env.DB.batch([
    sql(
      c.env,
      `INSERT INTO login_challenges(id,email,code_digest,locale,requester_ip_hash,created_at,expires_at,attempt_window_started_at,failed_attempts)
      SELECT ?,?,?,?,?,?,
      COALESCE((SELECT expires_at FROM login_challenges WHERE email=? AND consumed_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1),?),
      COALESCE((SELECT attempt_window_started_at FROM login_challenges WHERE email=? AND consumed_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1),?),
      COALESCE((SELECT failed_attempts FROM login_challenges WHERE email=? AND consumed_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1),0)
      WHERE (SELECT COUNT(*) FROM login_challenges WHERE email=? AND created_at>?)<3
      AND (SELECT COUNT(*) FROM login_challenges WHERE requester_ip_hash=? AND created_at>?)<20
      AND NOT EXISTS(SELECT 1 FROM login_challenges WHERE email=? AND created_at>?)
      AND NOT EXISTS(SELECT 1 FROM login_challenges WHERE email=? AND expires_at>? AND failed_attempts>=5)
      AND (?='' OR EXISTS(SELECT 1 FROM login_challenges WHERE id=? AND consumed_at IS NULL AND expires_at>? AND failed_attempts<5))`,
      challengeId,
      email,
      digest,
      locale,
      ip,
      date,
      email,
      date,
      iso(time + 600),
      email,
      date,
      date,
      email,
      date,
      email,
      iso(time - 900),
      ip,
      iso(time - 3600),
      email,
      iso(time - 60),
      email,
      date,
      action === 'resend' ? id : '',
      id,
      date,
    ),
    sql(
      c.env,
      `UPDATE login_challenges SET consumed_at=? WHERE email=? AND id<>? AND consumed_at IS NULL AND EXISTS(SELECT 1 FROM login_challenges WHERE id=?)`,
      date,
      email,
      challengeId,
      challengeId,
    ),
  ]);
  if (!inserted[0].meta.changes) {
    const blocked = await sql(
      c.env,
      'SELECT id FROM login_challenges WHERE email=? AND expires_at>? AND failed_attempts>=5',
      email,
      date,
    ).first();
    // Accurate retry horizon for cooldown and both sliding windows.
    const retry = await sql(
      c.env,
      `SELECT MAX(wait) AS wait FROM (
      SELECT MAX(1,60-(?-unixepoch(MAX(created_at)))) AS wait FROM login_challenges WHERE email=?
      UNION ALL SELECT MAX(1,900-(?-unixepoch(MIN(created_at)))) FROM login_challenges WHERE email=? AND created_at>? HAVING COUNT(*)>=3
      UNION ALL SELECT MAX(1,3600-(?-unixepoch(MIN(created_at)))) FROM login_challenges WHERE requester_ip_hash=? AND created_at>? HAVING COUNT(*)>=20)`,
      time,
      email,
      time,
      email,
      iso(time - 900),
      time,
      ip,
      iso(time - 3600),
    ).first<{ wait: number }>();
    c.header('Retry-After', String(retry?.wait || 60));
    return panel(
      c,
      action === 'resend' ? previous : null,
      [blocked ? 'error.code_attempts' : 'error.rate_limit'],
      blocked ? 200 : 429,
      { auth_email: email, auth_locale: locale },
    );
  }
  const challenge = await sql(
    c.env,
    'SELECT * FROM login_challenges WHERE id=?',
    challengeId,
  ).first<Challenge>();
  try {
    await sendCode(c.env, email, code, locale, challengeId);
  } catch {
    await sql(
      c.env,
      'UPDATE login_challenges SET consumed_at=? WHERE id=?',
      date,
      challengeId,
    ).run();
    return panel(c, null, ['error.email_send'], 200, { auth_email: email, auth_locale: locale });
  }
  return panel(
    c,
    challenge,
    [],
    200,
    action === 'resend' ? { auth_notice: 'auth.code.resent' } : {},
  );
};
export const logout: Handler<App> = async (c) => {
  if (validCsrf(c)) {
    await sql(c.env, 'DELETE FROM sessions WHERE token_hash=?', c.get('session').token_hash).run();
    cookie(c, '');
  }
  return redirect(c, '/');
};
