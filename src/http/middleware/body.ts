import { getCookie, setCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { type App } from '../../runtime/context';

// Bound all control-plane bodies, including chunked requests, before parsing.
export const body: MiddlewareHandler<App> = async (c, next) => {
  if (!['POST', 'PUT', 'PATCH'].includes(c.req.method)) return next();
  if (Number(c.req.header('Content-Length')) > 32768) throw new HTTPException(413);
  const reader = c.req.raw.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader)
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) {
        await reader.cancel();
        throw new HTTPException(413);
      }
      chunks.push(value);
    }
  const request = new Request(c.req.url, {
    method: 'POST',
    headers: c.req.raw.headers,
    body: new Blob(chunks),
  });
  let data: Record<string, unknown>;
  try {
    if ((c.req.header('Content-Type') || '').includes('application/json'))
      data = await request.json();
    else {
      const f = await request.formData();
      data = Object.fromEntries(f);
      if ([...f.values()].some((v) => typeof v !== 'string')) throw new Error('binary');
    }
    if (!data || Array.isArray(data) || typeof data !== 'object' || Object.keys(data).length > 100)
      throw new Error('body');
  } catch {
    throw new HTTPException(400);
  }
  c.set('form', data);
  await next();
};
