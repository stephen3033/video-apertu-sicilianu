import { it, expect } from 'vitest';
import { env, post, request, user, staged, submission, queueMock } from './helpers';
import { BUDGET, MAX_BYTES } from '../src/domain/limits';
import { sql } from '../src/infrastructure/database/query';
import { now } from '../src/utils/time';
import { type Upload } from '../src/domain/models';
import { cleanupUpload } from '../src/infrastructure/storage/r2';
import { recover } from '../src/jobs/recovery';
const details = () => ({
  title: 'Title',
  notes: 'notes',
  filename: 'voice.mp3',
  content_type: 'audio/mpeg',
  byte_size: 10,
  idempotency_key: crypto.randomUUID(),
});
it('keeps scoped history, navbar and full/fragment responses', async () => {
  const a = await user(),
    b = await user();
  await submission(a);
  const html = await (
    await request('/submissions', { headers: { Cookie: `vas_session=${a.token}` } })
  ).text();
  expect(html).toContain('data-persistent-navbar');
  expect(html).toContain('Sicìlia &lt;voice&gt;');
  expect(html).not.toContain('data-nav-section="review"');
  const other = await (
    await request('/submissions', {
      headers: { Cookie: `vas_session=${b.token}`, 'HX-Request': 'true' },
    })
  ).text();
  expect(other).not.toContain('Sicìlia');
  expect(other).not.toContain('<html');
  expect(other).toContain('history.empty');
});
it('reserves capacity atomically under concurrency and makes retries idempotent', async () => {
  const who = await user();
  for (let i = 0; i < 9; i++) await staged(who, 'x', MAX_BYTES);
  const responses = await Promise.all(
    Array.from({ length: 10 }, () =>
      post('/uploads/authorize', who, { ...details(), byte_size: 100_000_000 }),
    ),
  );
  expect(responses.filter((r) => r.status === 200)).toHaveLength(3);
  expect(responses.filter((r) => r.status === 507)).toHaveLength(7);
  expect(
    (await sql(env, "SELECT SUM(byte_size) total FROM uploads WHERE status<>'released'").first<{
      total: number;
    }>())!.total,
  ).toBeLessThanOrEqual(BUDGET);
  const input = { ...details(), byte_size: 1 };
  const repeated = await Promise.all([
    post('/uploads/authorize', who, input),
    post('/uploads/authorize', who, input),
  ]);
  expect(
    (await sql(
      env,
      'SELECT COUNT(*) n FROM uploads WHERE idempotency_key=?',
      input.idempotency_key,
    ).first<{ n: number }>())!.n,
  ).toBe(1);
  expect(repeated.some((r) => r.status === 200)).toBe(true);
});
it('fails closed when accounting is disabled and rejects metadata forgeries', async () => {
  const who = await user();
  await sql(env, 'UPDATE storage_control SET reservations_enabled=0').run();
  expect((await post('/uploads/authorize', who, details())).status).toBe(507);
  expect(
    (await post('/uploads/authorize', who, { ...details(), byte_size: MAX_BYTES + 1 })).status,
  ).toBe(400);
  expect(
    (await post('/uploads/authorize', who, { ...details(), filename: 'evil.html' })).status,
  ).toBe(400);
});
it('checks every part length and pins completed objects before binding once', async () => {
  const who = await user();
  const response = await post('/uploads/authorize', who, details());
  const { upload_id } = (await response.json()) as { upload_id: string };
  const u = (await sql(env, 'SELECT * FROM uploads WHERE id=?', upload_id).first<Upload>())!;
  const part = await env.STAGING_BUCKET.resumeMultipartUpload(
    u.object_key,
    u.multipart_id!,
  ).uploadPart(1, 'small');
  await sql(env, 'INSERT INTO upload_parts VALUES(?,?,?,?)', u.id, 1, 5, part.etag).run();
  expect((await post(`/uploads/${u.id}/complete`, who)).status).toBe(400);
  expect(await env.STAGING_BUCKET.head(u.object_key)).toBeNull();
  const good = await env.STAGING_BUCKET.resumeMultipartUpload(
    u.object_key,
    u.multipart_id!,
  ).uploadPart(1, '0123456789');
  await sql(
    env,
    'UPDATE upload_parts SET byte_size=10,etag=? WHERE upload_id=?',
    good.etag,
    u.id,
  ).run();
  expect((await post(`/uploads/${u.id}/complete`, who)).status).toBe(200);
  const responses = await Promise.all(
    [1, 2].map(() => post('/submissions', who, { upload_id: u.id, title: 'test' })),
  );
  expect(responses.every((r) => r.status === 200)).toBe(true);
  expect(
    (await sql(env, 'SELECT COUNT(*) n FROM submissions WHERE upload_id=?', u.id).first<{
      n: number;
    }>())!.n,
  ).toBe(1);
  expect((await post(`/uploads/${u.id}/parts`, who, { parts: [1] })).status).toBe(409);
});
it('checks ownership, CSRF and rejects binary control-plane bodies', async () => {
  const a = await user(),
    b = await user(),
    upload = await staged(a);
  expect((await post(`/uploads/${upload.id}/parts`, b, { parts: [1] })).status).toBe(404);
  expect((await post('/uploads/authorize', a, { ...details(), csrf_token: 'forged' })).status).toBe(
    403,
  );
  expect(
    (
      await request('/submissions', {
        method: 'POST',
        headers: { Cookie: `vas_session=${a.token}` },
        body: new Uint8Array(32769),
      })
    ).status,
  ).toBe(413);
});
it('releases canceled reservations after confirmed deletion and recovers expired uploads', async () => {
  const who = await user();
  const stagedUpload = await staged(who);
  expect((await post(`/uploads/${stagedUpload.id}/cancel`, who)).status).toBe(200);
  expect(await env.STAGING_BUCKET.head(stagedUpload.key)).toBeNull();
  const response = await post('/uploads/authorize', who, details());
  const { upload_id } = (await response.json()) as { upload_id: string };
  await sql(
    env,
    'UPDATE uploads SET expires_at=?,lease_until=0 WHERE id=?',
    now() - 1,
    upload_id,
  ).run();
  await recover(queueMock());
  expect(
    (await sql(env, 'SELECT status FROM uploads WHERE id=?', upload_id).first<{
      status: string;
    }>())!.status,
  ).toBe('released');
});
it('does not release capacity after failed storage deletion', async () => {
  const who = await user(),
    entry = await staged(who);
  await sql(env, "UPDATE uploads SET phase='cleanup' WHERE id=?", entry.id).run();
  const u = (await sql(env, 'SELECT * FROM uploads WHERE id=?', entry.id).first<Upload>())!;
  await expect(
    cleanupUpload(
      {
        ...env,
        STAGING_BUCKET: {
          delete: async () => {
            throw new Error('unavailable');
          },
        } as unknown as R2Bucket,
      },
      u,
    ),
  ).rejects.toThrow();
  expect(
    (await sql(env, 'SELECT status FROM uploads WHERE id=?', u.id).first<{ status: string }>())!
      .status,
  ).toBe('staged');
});
it('guards all review routes, honors revocation and permits only one competing decision', async () => {
  const who = await user(),
    reviewer = await user(true),
    s = await submission(who);
  const custom = queueMock();
  for (const path of ['/review', `/review/${s.id}/download`])
    expect((await request(path, { headers: { Cookie: `vas_session=${who.token}` } })).status).toBe(
      403,
    );
  for (const action of ['accept', 'reject', 'retry'])
    expect((await post(`/review/${s.id}/${action}`, who, {}, custom)).status).toBe(403);
  const navigation = await (
    await request('/submissions/new', { headers: { Cookie: `vas_session=${reviewer.token}` } })
  ).text();
  expect(navigation).toContain('data-nav-section="review"');
  expect(navigation).not.toContain('is_reviewer');
  const range = await request(`/review/${s.id}/download`, {
    headers: { Cookie: `vas_session=${reviewer.token}`, Range: 'bytes=1-4' },
  });
  expect(range.status).toBe(206);
  expect(await range.text()).toBe('ello');
  expect(range.headers.get('Content-Disposition')).toContain('attachment');
  const decisions = await Promise.all(
    ['accept', 'reject'].map((action) => post(`/review/${s.id}/${action}`, reviewer, {}, custom)),
  );
  expect(decisions.map((r) => r.status).sort()).toEqual([200, 409]);
  expect((await sql(env, 'SELECT COUNT(*) n FROM transfer_jobs').first<{ n: number }>())!.n).toBe(
    1,
  );
  expect((await sql(env, 'SELECT COUNT(*) n FROM outbox').first<{ n: number }>())!.n).toBe(1);
  await sql(env, 'UPDATE users SET is_reviewer=0 WHERE id=?', reviewer.id).run();
  expect((await post(`/review/${s.id}/retry`, reviewer, {}, custom)).status).toBe(403);
  expect(
    (
      await request(`/review/${s.id}/download`, {
        headers: { Cookie: `vas_session=${reviewer.token}` },
      })
    ).status,
  ).toBe(403);
});
it('allows cancellation after an interrupted completion lease expires', async () => {
  const who = await user();
  const response = await post('/uploads/authorize', who, details());
  const { upload_id } = (await response.json()) as { upload_id: string };
  await sql(env, "UPDATE uploads SET phase='completing',lease_until=0 WHERE id=?", upload_id).run();
  expect((await post(`/uploads/${upload_id}/cancel`, who)).status).toBe(200);
  expect(
    (await sql(env, 'SELECT status FROM uploads WHERE id=?', upload_id).first<{
      status: string;
    }>())!.status,
  ).toBe('released');
});
