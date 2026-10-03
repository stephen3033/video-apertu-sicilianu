import { env as bindings, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { vi } from 'vitest';
import { type Env } from '../src/runtime/bindings';
import { type Submission } from '../src/domain/models';
import { app } from '../src/http/app';
import { iso, now } from '../src/utils/time';
import { sql } from '../src/infrastructure/database/query';
import { randomToken, sha256 } from '../src/utils/crypto';
export const env = bindings as unknown as Env;
export async function request(path: string, init: RequestInit = {}, customEnv: Env = env) {
  const context = createExecutionContext();
  const response = await app.fetch(
    new Request('http://localhost:8787' + path, init),
    customEnv,
    context,
  );
  await waitOnExecutionContext(context);
  return response;
}
export async function user(reviewer = false) {
  const id = crypto.randomUUID(),
    token = randomToken(),
    csrf = randomToken();
  await sql(
    env,
    'INSERT INTO users(id,email,created_at,email_verified_at,is_reviewer) VALUES(?,?,?,?,?)',
    id,
    `${id}@example.com`,
    iso(),
    iso(),
    Number(reviewer),
  ).run();
  await sql(
    env,
    'INSERT INTO sessions(token_hash,csrf_token,user_id,authenticated_at,expires_at,created_at) VALUES(?,?,?,?,?,?)',
    await sha256(token),
    csrf,
    id,
    now(),
    now() + 43200,
    now(),
  ).run();
  return { id, token, csrf };
}
export type TestUser = Awaited<ReturnType<typeof user>>;
export function post(
  path: string,
  who: TestUser,
  data: Record<string, unknown> = {},
  customEnv = env,
) {
  return request(
    path,
    {
      method: 'POST',
      headers: {
        Cookie: `vas_session=${who.token}`,
        'Content-Type': 'application/json',
        'HX-Request': 'true',
        Origin: env.APP_ORIGIN,
      },
      body: JSON.stringify({ csrf_token: who.csrf, ...data }),
    },
    customEnv,
  );
}
export async function staged(who: TestUser, data = 'hello audio', size = data.length) {
  const id = crypto.randomUUID(),
    key = `staging/${id}.mp3`;
  const object = await env.STAGING_BUCKET.put(key, data, {
    httpMetadata: { contentType: 'audio/mpeg' },
    customMetadata: { upload_id: id },
  });
  await sql(
    env,
    `INSERT INTO uploads(id,user_id,object_key,original_filename,content_type,media_kind,byte_size,status,created_at,expires_at,cleanup_after,idempotency_key,phase,etag) VALUES(?,?,?,'voice.mp3','audio/mpeg','audio',?,'staged',?,?,?,?,'complete',?)`,
    id,
    who.id,
    key,
    size,
    now(),
    now() + 86400,
    now() + 86400,
    id,
    object.etag,
  ).run();
  return { id, key, etag: object.etag };
}
export async function submission(who: TestUser, data = 'hello audio') {
  const upload = await staged(who, data);
  await post('/submissions', who, {
    upload_id: upload.id,
    title: 'Sicìlia <voice>',
    notes: 'A recording',
  });
  return (await sql(
    env,
    'SELECT * FROM submissions WHERE upload_id=?',
    upload.id,
  ).first<Submission>())!;
}
export function queueMock() {
  const send = vi.fn(async () => {});
  return { ...env, PUBLICATION_QUEUE: { send } as unknown as Queue };
}
