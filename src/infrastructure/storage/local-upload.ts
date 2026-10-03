// Local-only transport adapter. Deployed configuration rejects LOCAL_UPLOAD_ORIGIN.
import { type Env } from '../../runtime/bindings';
import { type Upload } from '../../domain/models';
import { hmac } from '../../utils/crypto';
import { now } from '../../utils/time';
import { sql } from '../database/query';
import { partSize } from './r2';
export async function localUpload(request: Request, env: Env) {
  const url = new URL(request.url);
  if (env.APP_ENV !== 'local' || !env.LOCAL_UPLOAD_ORIGIN)
    return new Response('Not found', { status: 404 });
  const headers = {
    'Access-Control-Allow-Origin': env.APP_ORIGIN,
    'Access-Control-Allow-Methods': 'PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Expose-Headers': 'ETag',
    Vary: 'Origin',
  };
  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'PUT' || request.headers.get('Origin') !== env.APP_ORIGIN)
    return new Response('Forbidden', { status: 403 });
  const match = /^\/__local\/uploads\/([^/]+)\/(\d+)$/.exec(url.pathname);
  if (!match) return new Response(null, { status: 404 });
  const [, id, part] = match;
  const n = Number(part),
    size = Number(url.searchParams.get('size')),
    expiry = Number(url.searchParams.get('expiry'));
  const expected = await hmac(env.AUTH_CODE_SECRET, `${id}:${n}:${size}:${expiry}`);
  if (expiry <= now() || expected !== url.searchParams.get('signature'))
    return new Response(null, { status: 403, headers });
  const u = await sql(
    env,
    'SELECT * FROM uploads WHERE id=? AND phase=?',
    id,
    'uploading',
  ).first<Upload>();
  if (
    !u ||
    u.expires_at <= now() ||
    size !== partSize(u, n) ||
    Number(request.headers.get('Content-Length')) !== size ||
    !request.body
  )
    return new Response(null, { status: 400, headers });
  const stored = await env.STAGING_BUCKET.resumeMultipartUpload(
    u.object_key,
    u.multipart_id!,
  ).uploadPart(n, request.body);
  await sql(
    env,
    `INSERT INTO upload_parts(upload_id,part_number,byte_size,etag) VALUES(?,?,?,?) ON CONFLICT(upload_id,part_number) DO UPDATE SET byte_size=excluded.byte_size,etag=excluded.etag`,
    id,
    n,
    size,
    stored.etag,
  ).run();
  return new Response(null, { headers: { ...headers, ETag: stored.etag } });
}
