import { describe, it, expect, vi, afterEach } from 'vitest';
import { env, request, user, post } from './helpers';
import { hmac, sha256 } from '../src/utils/crypto';
import { now, iso } from '../src/utils/time';
import { sql } from '../src/infrastructure/database/query';
import { type Challenge } from '../src/domain/models';
afterEach(() => vi.restoreAllMocks());
async function anonymous() {
  const response = await request('/');
  const html = await response.text();
  return {
    id: '',
    token: response.headers.get('Set-Cookie')!.match(/vas_session=([^;]+)/)![1],
    csrf: html.match(/name="csrf_token" value="([^"]+)"/)![1],
  };
}
async function code(who: Awaited<ReturnType<typeof anonymous>>, email = 'person@example.com') {
  const messages: { code: string; locale: string }[] = [];
  const custom = {
    ...env,
    TEST_EMAIL: {
      fetch: async (_url: unknown, init: RequestInit) => {
        messages.push(JSON.parse(init.body as string));
        return new Response(null);
      },
    } as unknown as Fetcher,
  };
  const response = await post('/auth/code/request', who, { email, locale: 'scn' }, custom);
  const challenge = await sql(
    env,
    'SELECT * FROM login_challenges WHERE email=? ORDER BY created_at DESC',
    email,
  ).first<Challenge>();
  return { response, challenge: challenge!, code: messages[0]?.code, messages, custom };
}
describe('authentication parity', () => {
  it('preserves all three languages and escaped account fragments', async () => {
    const html = await (await request('/')).text();
    expect(html).toContain('id="auth-panel"');
    expect(html).toContain('data-i18n-scn');
    expect(html).toContain('data-i18n-it');
    expect(html).toContain('hx-target="#auth-panel"');
    const who = await anonymous();
    const invalid = await post('/auth/code/request', who, { email: '"><script>alert(1)</script>' });
    const out = await invalid.text();
    expect(out).not.toContain('<script>alert');
    expect(out).toContain('&lt;script&gt;');
  });
  it('atomically consumes a code once, creates one user and rotates the session', async () => {
    const who = await anonymous();
    const result = await code(who);
    expect(result.messages[0].locale).toBe('scn');
    expect(result.code).toMatch(/^\d{6}$/);
    expect(await sql(env, 'SELECT id FROM users').first()).toBeNull();
    const responses = await Promise.all(
      [1, 2, 3].map(() =>
        post('/auth/code/verify', who, { challenge_id: result.challenge.id, code: result.code }),
      ),
    );
    expect(responses.filter((r) => r.status === 204)).toHaveLength(1);
    expect((await sql(env, 'SELECT COUNT(*) n FROM users').first<{ n: number }>())?.n).toBe(1);
    expect(
      await sql(env, 'SELECT * FROM sessions WHERE token_hash=?', await sha256(who.token)).first(),
    ).toBeNull();
    const cookie = responses.find((r) => r.status === 204)!.headers.get('Set-Cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('Max-Age');
    expect(cookie).not.toContain('Expires');
    expect(responses.find((r) => r.status === 204)!.headers.get('HX-Redirect')).toBe(
      '/submissions/new',
    );
  });
  it('limits concurrent code sends and does not reset attempts or expiry on resend', async () => {
    const who = await anonymous();
    let count = 0;
    const custom = {
      ...env,
      TEST_EMAIL: {
        fetch: async () => {
          count++;
          return new Response(null);
        },
      } as unknown as Fetcher,
    };
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        post('/auth/code/request', who, { email: 'concurrent@example.com' }, custom),
      ),
    );
    expect(responses.filter((r) => r.status === 429)).toHaveLength(4);
    expect(count).toBe(1);
    const original = (await sql(env, 'SELECT * FROM login_challenges').first<Challenge>())!;
    await sql(
      env,
      'UPDATE login_challenges SET failed_attempts=3,created_at=? WHERE id=?',
      iso(now() - 61),
      original.id,
    ).run();
    expect(
      (await post('/auth/code/resend', who, { challenge_id: original.id }, custom)).status,
    ).toBe(200);
    const replacement = (await sql(
      env,
      'SELECT * FROM login_challenges WHERE consumed_at IS NULL',
    ).first<Challenge>())!;
    expect(replacement.failed_attempts).toBe(3);
    expect(replacement.expires_at).toBe(original.expires_at);
    expect(replacement.id).not.toBe(original.id);
    await post('/auth/code/verify', who, { challenge_id: replacement.id, code: 'wrong' });
    await post('/auth/code/verify', who, { challenge_id: replacement.id, code: 'wrong' });
    expect(
      (await sql(
        env,
        'SELECT failed_attempts FROM login_challenges WHERE id=?',
        replacement.id,
      ).first<{ failed_attempts: number }>())!.failed_attempts,
    ).toBe(5);
    await sql(env, 'UPDATE login_challenges SET created_at=?', iso(now() - 61)).run();
    expect(
      await (
        await post('/auth/code/request', who, { email: 'concurrent@example.com' }, custom)
      ).text(),
    ).toContain('error.code_attempts');
  });
  it('enforces email and IP sliding windows', async () => {
    const who = await anonymous();
    const ip = await hmac(env.AUTH_CODE_SECRET, 'ip:local');
    for (let i = 0; i < 20; i++)
      await sql(
        env,
        `INSERT INTO login_challenges(id,email,code_digest,locale,requester_ip_hash,created_at,expires_at,attempt_window_started_at) VALUES(?,?,?,'en',?,?,?,?)`,
        crypto.randomUUID(),
        i < 3 ? 'limited@example.com' : `${i}@example.com`,
        'digest',
        ip,
        iso(now() - 120 - i),
        iso(now() + 600),
        iso(),
      ).run();
    expect((await post('/auth/code/request', who, { email: 'limited@example.com' })).status).toBe(
      429,
    );
    expect((await post('/auth/code/request', who, { email: 'new@example.com' })).status).toBe(429);
  });
  it('rejects expired codes, CSRF, expired sessions and invalidates logout', async () => {
    const who = await anonymous(),
      result = await code(who);
    const wrong = await post('/auth/code/verify', who, {
      challenge_id: result.challenge.id,
      code: result.code,
      csrf_token: 'bad',
    });
    expect(await wrong.text()).toContain('error.csrf');
    await sql(env, 'UPDATE login_challenges SET expires_at=?', iso(now() - 1)).run();
    expect(
      await (
        await post('/auth/code/verify', who, {
          challenge_id: result.challenge.id,
          code: result.code,
        })
      ).text(),
    ).toContain('error.code_expired');
    const signed = await user();
    await sql(env, 'UPDATE sessions SET expires_at=? WHERE user_id=?', now() - 1, signed.id).run();
    expect(
      (
        await request('/submissions', {
          headers: { Cookie: `vas_session=${signed.token}`, 'HX-Request': 'true' },
        })
      ).status,
    ).toBe(401);
    const current = await user();
    await post('/auth/logout', current);
    expect(await sql(env, 'SELECT * FROM sessions WHERE user_id=?', current.id).first()).toBeNull();
  });
  it('never delivers through console outside local development', async () => {
    const log = vi.spyOn(console, 'log');
    const who = await anonymous();
    const response = await post(
      '/auth/code/request',
      who,
      { email: 'production@example.com' },
      { ...env, APP_ENV: 'production', EMAIL_BACKEND: 'console', LOCAL_UPLOAD_ORIGIN: undefined },
    );
    expect(response.status).toBe(503);
    expect(log).not.toHaveBeenCalled();
  });
});
