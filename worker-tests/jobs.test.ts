import { it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { env, user, submission, post, queueMock, staged } from './helpers';
import { now } from '../src/utils/time';
import { sql } from '../src/infrastructure/database/query';
import { TRANSFER_PART, MAX_BYTES } from '../src/domain/limits';
import { type Job, type Submission } from '../src/domain/models';
import { processJob, deadLetter } from '../src/jobs/publication';
import { dispatchOutbox } from '../src/jobs/outbox';
import { recover, reconcile } from '../src/jobs/recovery';
import { archiveRequest, metadata, multipartETag, smallXML } from '../src/infrastructure/archive/client';
afterEach(() => vi.restoreAllMocks());
async function accepted() {
  const owner = await user(),
    reviewer = await user(true),
    s = await submission(owner),
    custom = queueMock();
  await post(`/review/${s.id}/accept`, reviewer, {}, custom);
  return {
    s,
    reviewer,
    custom,
    j: (await sql(env, 'SELECT * FROM transfer_jobs WHERE submission_id=?', s.id).first<Job>())!,
  };
}
async function next(custom = env) {
  const j = (await sql(
    env,
    "SELECT * FROM transfer_jobs WHERE state NOT IN ('done','failed') LIMIT 1",
  ).first<Job>())!;
  if (j) await processJob(custom, { job_id: j.id, generation: j.generation, step: j.step });
}
async function drain(body: BodyInit | null | undefined) {
  if (!(body instanceof ReadableStream)) throw new Error('Expected streaming body');
  const reader = body.getReader(),
    hash = createHash('md5');
  let bytes = 0,
    maxChunk = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    maxChunk = Math.max(maxChunk, value.byteLength);
    hash.update(value);
  }
  return { bytes, maxChunk, etag: hash.digest('hex') };
}
it('dispatches committed outbox and treats duplicate deliveries idempotently', async () => {
  const { s, j, custom } = await accepted();
  await dispatchOutbox(custom);
  expect(custom.PUBLICATION_QUEUE.send).toHaveBeenCalledTimes(1);
  await Promise.all(
    [1, 2, 3].map(() =>
      processJob(custom, { job_id: j.id, generation: j.generation, step: j.step }),
    ),
  );
  expect(
    (await sql(env, 'SELECT step FROM transfer_jobs WHERE id=?', j.id).first<{ step: number }>())!
      .step,
  ).toBe(1);
  expect(
    (await sql(env, 'SELECT lifecycle FROM submissions WHERE id=?', s.id).first<Submission>())!
      .lifecycle,
  ).toBe('transferring');
});
it('streams IAS3, commits acceptance before deletion, and releases capacity only afterward', async () => {
  const { s, custom } = await accepted();
  await next(custom);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const sent = await drain(init?.body);
    expect(sent.bytes).toBe(s.byte_size);
    return new Response('', { headers: { ETag: `"${sent.etag}"` } });
  });
  const bucket = custom.STAGING_BUCKET;
  const deleteSpy = vi.fn(async (key: string) => {
    const state = (await sql(
      env,
      'SELECT * FROM submissions WHERE id=?',
      s.id,
    ).first<Submission>())!;
    expect(state.upstream_url).toContain('archive.org/download');
    expect(state.lifecycle).toBe('cleanup_pending');
    expect(
      (await sql(env, 'SELECT status FROM uploads WHERE id=?', s.upload_id).first<{
        status: string;
      }>())!.status,
    ).toBe('staged');
    await bucket.delete(key);
  });
  await next({
    ...custom,
    STAGING_BUCKET: new Proxy(bucket, {
      get(target, p) {
        return p === 'delete'
          ? deleteSpy
          : typeof target[p as keyof R2Bucket] === 'function'
            ? (target[p as keyof R2Bucket] as Function).bind(target)
            : target[p as keyof R2Bucket];
      },
    }),
  });
  expect(deleteSpy).toHaveBeenCalledTimes(1);
  expect(await env.STAGING_BUCKET.head(s.storage_ref)).toBeNull();
  expect(
    (await sql(env, 'SELECT lifecycle FROM submissions WHERE id=?', s.id).first<Submission>())!
      .lifecycle,
  ).toBe('published');
});
it('retains staging after throttling and recovers lost PUT acknowledgements with HEAD', async () => {
  const { s, custom } = await accepted();
  await next(custom);
  let etag = '';
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    etag = (await drain(init?.body)).etag;
    throw new Error('lost acknowledgement');
  });
  await expect(next(custom)).rejects.toThrow();
  expect(await env.STAGING_BUCKET.head(s.storage_ref)).not.toBeNull();
  await sql(env, 'UPDATE transfer_jobs SET next_attempt_at=0').run();
  fetch.mockImplementation(async (_url, init) => {
    expect(init?.method).toBe('HEAD');
    return new Response(null, {
      headers: { ETag: `"${etag}"`, 'Content-Length': String(s.byte_size) },
    });
  });
  await next(custom);
  expect(await env.STAGING_BUCKET.head(s.storage_ref)).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('retries failed deletion without retransmitting and persists dead letters by generation', async () => {
  const { s, custom, reviewer } = await accepted();
  await next(custom);
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(
      async (_url, init) =>
        new Response('', { headers: { ETag: `"${(await drain(init?.body)).etag}"` } }),
    );
  const failingBucket = new Proxy(env.STAGING_BUCKET, {
    get(target, p) {
      if (p === 'delete')
        return async () => {
          throw new Error('delete failed');
        };
      const v = target[p as keyof R2Bucket];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  await expect(next({ ...custom, STAGING_BUCKET: failingBucket })).rejects.toThrow();
  expect(await env.STAGING_BUCKET.head(s.storage_ref)).not.toBeNull();
  let j = (await sql(env, 'SELECT * FROM transfer_jobs WHERE submission_id=?', s.id).first<Job>())!;
  expect(j.state).toBe('cleanup');
  await deadLetter(custom, { job_id: j.id, generation: j.generation, step: j.step });
  expect(
    (await sql(env, 'SELECT lifecycle FROM submissions WHERE id=?', s.id).first<Submission>())!
      .lifecycle,
  ).toBe('failed');
  await post(`/review/${s.id}/retry`, reviewer, {}, custom);
  await deadLetter(custom, { job_id: j.id, generation: j.generation, step: j.step });
  expect(
    (await sql(env, 'SELECT state FROM transfer_jobs WHERE id=?', j.id).first<Job>())!.state,
  ).toBe('cleanup');
  await next(custom);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await env.STAGING_BUCKET.head(s.storage_ref)).toBeNull();
});
it('recovers outbox sends, leases, and refuses storage discrepancies', async () => {
  const { j, custom } = await accepted();
  await sql(env, 'UPDATE transfer_jobs SET lease_until=?', now() - 1).run();
  await sql(env, 'UPDATE outbox SET sent_at=?', now() - 1300).run();
  await recover(custom);
  expect(custom.PUBLICATION_QUEUE.send).toHaveBeenCalledTimes(2);
  await env.STAGING_BUCKET.put('unknown', 'unexpected');
  await reconcile(custom);
  expect(
    (await sql(env, 'SELECT reservations_enabled FROM storage_control').first<{
      reservations_enabled: number;
    }>())!.reservations_enabled,
  ).toBe(0);
});
it('rejects embedded completion errors and credential-bearing redirects to untrusted hosts', async () => {
  await expect(smallXML(new Response('<Error><Code>SlowDown</Code></Error>'))).rejects.toThrow(
    'archive_xml_error',
  );
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      new Response(null, { status: 307, headers: { Location: 'https://evil.example/steal' } }),
    );
  await expect(archiveRequest(env, 'https://s3.us.archive.org/item/file', 'HEAD')).rejects.toThrow(
    'archive_redirect',
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('encodes Unicode Archive metadata and excludes contributor identity', async () => {
  const { s } = await accepted();
  const headers = metadata(s);
  expect(headers['x-archive-meta-title']).toMatch(/^uri\(/);
  expect(JSON.stringify(headers)).not.toContain('@example.com');
});
it.each([101 * 1024 * 1024 + 1, MAX_BYTES])(
  'streams %i bytes in resumable 64 MiB parts with bounded chunks',
  async (size) => {
    const owner = await user(),
      reviewer = await user(true),
      custom = queueMock();
    const id = crypto.randomUUID(),
      key = `staging/${id}.mp3`;
    const fixed = new FixedLengthStream(size);
    const writer = fixed.writable.getWriter();
    const writing = (async () => {
      let remaining = size;
      while (remaining) {
        const n = Math.min(65536, remaining);
        await writer.write(new Uint8Array(n));
        remaining -= n;
      }
      await writer.close();
    })();
    const object = await env.STAGING_BUCKET.put(key, fixed.readable, {
      httpMetadata: { contentType: 'audio/mpeg' },
      customMetadata: { upload_id: id },
    });
    await writing;
    await sql(
      env,
      `INSERT INTO uploads(id,user_id,object_key,original_filename,content_type,media_kind,byte_size,status,created_at,expires_at,cleanup_after,idempotency_key,phase,etag) VALUES(?,?,?,'large.mp3','audio/mpeg','audio',?,'staged',?,?,?,?,'complete',?)`,
      id,
      owner.id,
      key,
      size,
      now(),
      now() + 86400,
      now() + 86400,
      id,
      object.etag,
    ).run();
    await post('/submissions', owner, { title: 'Large recording', upload_id: id });
    const s = (await sql(
      env,
      'SELECT * FROM submissions WHERE upload_id=?',
      id,
    ).first<Submission>())!;
    await post(`/review/${s.id}/accept`, reviewer, {}, custom);
    const parts: { etag: string }[] = [];
    const lengths: number[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const parsed = new URL(String(url));
      if (init?.method === 'HEAD') return new Response(null, { status: 404 });
      if (init?.method === 'GET')
        return new Response(
          '<ListMultipartUploadsResult><IsTruncated>false</IsTruncated></ListMultipartUploadsResult>',
        );
      if (parsed.searchParams.has('uploads'))
        return new Response(
          '<InitiateMultipartUploadResult><UploadId>archive-upload</UploadId></InitiateMultipartUploadResult>',
        );
      if (init?.method === 'PUT') {
        const sent = await drain(init.body);
        expect(sent.maxChunk).toBeLessThanOrEqual(1024 * 1024);
        parts.push({ etag: sent.etag });
        lengths.push(sent.bytes);
        return new Response('', { headers: { ETag: `"${sent.etag}"` } });
      }
      return new Response(
        `<CompleteMultipartUploadResult><ETag>"${multipartETag(parts)}"</ETag></CompleteMultipartUploadResult>`,
      );
    });
    for (let stage = 0; stage < Math.ceil(size / TRANSFER_PART) + 3; stage++) await next(custom);
    expect(lengths).toEqual(
      Array.from({ length: Math.ceil(size / TRANSFER_PART) }, (_, i) =>
        Math.min(TRANSFER_PART, size - i * TRANSFER_PART),
      ),
    );
    expect(
      (await sql(env, 'SELECT lifecycle FROM submissions WHERE id=?', s.id).first<Submission>())!
        .lifecycle,
    ).toBe('published');
    expect(
      (await sql(env, 'SELECT COUNT(*) n FROM transfer_parts').first<{ n: number }>())!.n,
    ).toBe(Math.ceil(size / TRANSFER_PART));
  },
  60000,
);
it('deletes rejected media without sending it to Archive and retains review metadata', async () => {
  const who = await user(),
    reviewer = await user(true),
    s = await submission(who),
    custom = queueMock();
  const fetch = vi.spyOn(globalThis, 'fetch');
  await post(`/review/${s.id}/reject`, reviewer, {}, custom);
  await next(custom);
  expect(fetch).not.toHaveBeenCalled();
  expect(await env.STAGING_BUCKET.head(s.storage_ref)).toBeNull();
  const retained = (await sql(
    env,
    'SELECT * FROM submissions WHERE id=?',
    s.id,
  ).first<Submission>())!;
  expect(retained.title).toBe(s.title);
  expect(retained.review_decision).toBe('rejected');
  expect(retained.lifecycle).toBe('rejected');
});
it('disables new reservations if storage reconciliation is unavailable', async () => {
  const custom = queueMock();
  const bucket = new Proxy(env.STAGING_BUCKET, {
    get(target, p) {
      if (p === 'list')
        return async () => {
          throw new Error('inventory offline');
        };
      const value = target[p as keyof R2Bucket];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  await recover({ ...custom, STAGING_BUCKET: bucket });
  expect(
    (await sql(env, 'SELECT reservations_enabled FROM storage_control').first<{
      reservations_enabled: number;
    }>())!.reservations_enabled,
  ).toBe(0);
});
