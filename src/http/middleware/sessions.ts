import { getCookie, setCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { type App, type Ctx } from '../../runtime/context';
import { type Session, type User } from '../../domain/models';
import { now } from '../../utils/time';
import { sql } from '../../infrastructure/database/query';
import { randomToken, sha256 } from '../../utils/crypto';
export function cookie(c: Ctx, token: string) {
  setCookie(c, 'vas_session', token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: c.env.APP_ENV !== 'local',
    path: '/',
  });
}
export const sessions: MiddlewareHandler<App> = async (c, next) => {
  const token = getCookie(c, 'vas_session');
  let session =
    token && /^[a-f0-9]{64}$/.test(token)
      ? await sql(
          c.env,
          'SELECT * FROM sessions WHERE token_hash=? AND expires_at>?',
          await sha256(token),
          now(),
        ).first<Session>()
      : null;
  if (!session) {
    const token = randomToken();
    session = {
      token_hash: await sha256(token),
      csrf_token: randomToken(),
      user_id: null,
      authenticated_at: null,
      expires_at: now() + 43200,
    };
    await sql(
      c.env,
      'INSERT INTO sessions(token_hash,csrf_token,expires_at,created_at) VALUES(?,?,?,?)',
      session.token_hash,
      session.csrf_token,
      session.expires_at,
      now(),
    ).run();
    cookie(c, token);
  }
  c.set('session', session);
  c.set(
    'user',
    session.user_id
      ? await sql(
          c.env,
          'SELECT id,email,created_at,email_verified_at FROM users WHERE id=?',
          session.user_id,
        ).first<User>()
      : null,
  );
  c.header('Cache-Control', 'no-store');
  await next();
};
