import { getCookie, setCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { type App, type Ctx } from '../../runtime/context';
import { sql } from '../../infrastructure/database/query';
import { redirect } from '../requests';
export const requireUser: MiddlewareHandler<App> = async (c, next) => {
  if (!c.get('user')) return redirect(c, '/', 401);
  await next();
};
export async function isReviewer(c: Ctx) {
  const user = c.get('user');
  return (
    !!user &&
    !!(await sql(c.env, 'SELECT id FROM users WHERE id=? AND is_reviewer=1', user.id).first())
  );
}
export const requireReviewer: MiddlewareHandler<App> = async (c, next) => {
  if (!c.get('user')) return redirect(c, '/', 401);
  if (!(await isReviewer(c))) throw new HTTPException(403, { message: 'error.reviewer' });
  await next();
};
export function validCsrf(c: Ctx) {
  const origin = c.req.header('Origin');
  return (
    (!origin || origin === c.env.APP_ORIGIN) &&
    c.get('form').csrf_token === c.get('session').csrf_token
  );
}
export const csrf: MiddlewareHandler<App> = async (c, next) => {
  if (!validCsrf(c)) throw new HTTPException(403, { message: 'error.csrf' });
  await next();
};
