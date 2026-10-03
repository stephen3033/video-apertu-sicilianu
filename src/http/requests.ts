import { type Ctx } from '../runtime/context';
export const htmx = (c: Ctx) => c.req.header('HX-Request')?.toLowerCase() === 'true';
export function redirect(c: Ctx, destination: string, status: 204 | 401 = 204) {
  if (htmx(c)) return c.body(null, status, { 'HX-Redirect': destination });
  return c.redirect(destination, 303);
}
export const field = (c: Ctx, name: string) =>
  typeof c.get('form')[name] === 'string' ? (c.get('form')[name] as string).trim() : '';
