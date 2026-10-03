import type { Handler } from 'hono';
import { mediaMetadata, metadataErrors } from '../domain/media';
import { HTTPException } from 'hono/http-exception';
import { type App, type Ctx } from '../runtime/context';
import { type Upload } from '../domain/models';
import { BUDGET, MAX_BYTES, UPLOAD_PART } from '../domain/limits';
import { now } from '../utils/time';
import { sql } from '../infrastructure/database/query';
import { field } from '../http/requests';
import { cleanupUpload, listParts, partSize, partUrl, verifyObject } from '../infrastructure/storage/r2';
async function owned(c: Ctx) {
  const u = await sql(
    c.env,
    'SELECT * FROM uploads WHERE id=? AND user_id=?',
    c.req.param('id')!,
    c.get('user')!.id,
  ).first<Upload>();
  if (!u) throw new HTTPException(404);
  return u;
}
export const authorizeUpload: Handler<App> = async (c) => {
  const errors = metadataErrors(field(c, 'title'), field(c, 'notes'));
  if (errors.length) throw new HTTPException(400, { message: errors[0] });
  const meta = mediaMetadata(field(c, 'filename'), field(c, 'content_type'));
  const size = c.get('form').byte_size;
  if (!Number.isSafeInteger(size) || Number(size) <= 0 || Number(size) > MAX_BYTES)
    throw new HTTPException(400, { message: 'error.file_size' });
  const key = field(c, 'idempotency_key');
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(key)) throw new HTTPException(400);
  const id = crypto.randomUUID(),
    user = c.get('user')!,
    time = now();
  const result = await sql(
    c.env,
    `INSERT INTO uploads(id,user_id,object_key,original_filename,content_type,media_kind,byte_size,status,created_at,expires_at,cleanup_after,idempotency_key,phase,lease_until)
    SELECT ?,?,?,?,?,?,?,'reserved',?,?,?,?, 'initializing',?
    WHERE EXISTS(SELECT 1 FROM storage_control WHERE id=1 AND reservations_enabled=1)
    AND COALESCE((SELECT SUM(byte_size) FROM uploads WHERE status<>'released'),0)+?<=?
    ON CONFLICT(user_id,idempotency_key) DO NOTHING`,
    id,
    user.id,
    `staging/${id}${meta.extension}`,
    meta.original,
    meta.contentType,
    meta.kind,
    Number(size),
    time,
    time + 86400,
    time + 86400,
    key,
    time + 900,
    Number(size),
    BUDGET,
  ).run();
  let upload = await sql(
    c.env,
    'SELECT * FROM uploads WHERE user_id=? AND idempotency_key=?',
    user.id,
    key,
  ).first<Upload>();
  if (!upload) throw new HTTPException(507, { message: 'error.capacity' });
  if (
    upload.byte_size !== size ||
    upload.original_filename !== meta.original ||
    upload.content_type !== meta.contentType
  )
    throw new HTTPException(409, { message: 'error.upload' });
  if (result.meta.changes) {
    const multipart = await c.env.STAGING_BUCKET.createMultipartUpload(upload.object_key, {
      httpMetadata: { contentType: upload.content_type },
      customMetadata: { upload_id: upload.id },
    });
    const updated = await sql(
      c.env,
      `UPDATE uploads SET multipart_id=?,phase='uploading',lease_until=0 WHERE id=? AND phase='initializing'`,
      multipart.uploadId,
      upload.id,
    ).run();
    if (!updated.meta.changes) {
      await multipart.abort();
      throw new HTTPException(409);
    }
    upload = { ...upload, multipart_id: multipart.uploadId, phase: 'uploading' };
  }
  if (
    upload.expires_at <= time ||
    !['uploading', 'completing', 'complete', 'bound'].includes(upload.phase)
  )
    throw new HTTPException(409, { message: 'error.upload' });
  return c.json({
    upload_id: upload.id,
    part_size: UPLOAD_PART,
    concurrency: 2,
    phase: upload.phase,
  });
};
export const authorizeParts: Handler<App> = async (c) => {
  const u = await owned(c);
  if (u.phase !== 'uploading' || u.expires_at <= now())
    throw new HTTPException(409, { message: 'error.upload' });
  const numbers = c.get('form').parts;
  if (!Array.isArray(numbers) || !numbers.length || numbers.length > 64)
    throw new HTTPException(400);
  for (const n of numbers)
    try {
      partSize(u, n);
    } catch {
      throw new HTTPException(400);
    }
  return c.json({ parts: await Promise.all(numbers.map((n) => partUrl(c.env, u, n))) });
};
export const completeUpload: Handler<App> = async (c) => {
  let u = await owned(c);
  if (['complete', 'bound'].includes(u.phase)) return c.json({ upload_id: u.id });
  const token = crypto.randomUUID();
  const locked = await sql(
    c.env,
    `UPDATE uploads SET phase='completing',lease_token=?,lease_until=? WHERE id=? AND expires_at>? AND (phase='uploading' OR (phase='completing' AND lease_until<?))`,
    token,
    now() + 900,
    u.id,
    now(),
    now(),
  ).run();
  if (!locked.meta.changes) throw new HTTPException(409, { message: 'error.upload' });
  try {
    let object = await c.env.STAGING_BUCKET.head(u.object_key);
    if (!object) {
      const parts = await listParts(c.env, u);
      if (
        parts.length !== Math.ceil(u.byte_size / UPLOAD_PART) ||
        parts.some((p, i) => p.partNumber !== i + 1 || p.size !== partSize(u, i + 1) || !p.etag)
      )
        throw new HTTPException(400, { message: 'error.upload' });
      await c.env.STAGING_BUCKET.resumeMultipartUpload(u.object_key, u.multipart_id!).complete(
        parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })),
      );
    }
    object = await verifyObject(c.env, u);
    const updated = await sql(
      c.env,
      `UPDATE uploads SET phase='complete',status='staged',etag=?,lease_token=NULL,lease_until=0 WHERE id=? AND phase='completing' AND lease_token=?`,
      object.etag,
      u.id,
      token,
    ).run();
    if (!updated.meta.changes) throw new HTTPException(409);
    return c.json({ upload_id: u.id });
  } catch (error) {
    // Preserve completed objects after ambiguous completion; retry/recovery verifies HEAD.
    await sql(
      c.env,
      `UPDATE uploads SET lease_until=0 WHERE id=? AND lease_token=?`,
      u.id,
      token,
    ).run();
    throw error;
  }
};
export const cancelUpload: Handler<App> = async (c) => {
  let u = await owned(c);
  if (u.phase === 'released') return c.json({ canceled: true });
  const result = await sql(
    c.env,
    `UPDATE uploads SET phase='cleanup' WHERE id=? AND phase IN ('initializing','uploading','completing','complete','cleanup') AND lease_until<?`,
    u.id,
    now(),
  ).run();
  if (!result.meta.changes) throw new HTTPException(409);
  await cleanupUpload(c.env, { ...u, phase: 'cleanup' });
  return c.json({ canceled: true });
};
