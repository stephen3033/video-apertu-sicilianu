import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { control, controlOrigin, login, state, terminal, uniqueEmail, upload } from './helpers';
declare const htmx: typeof import('htmx.org').default;

test.beforeEach(async ({ request }) => {
  await control(request, '/capacity?enabled=true');
  await control(request, '/archive/fault?mode=none');
});

test('separate reviewer publishes and rejects through real local queues', async ({ page, browser, request }) => {
  await login(page);
  const bytes = Buffer.from('Sicìlia: recorded testimony');
  const accepted = await upload(page, `Publish ${crypto.randomUUID()}`, { name: 'voce.mp3', mimeType: 'audio/mpeg', buffer: bytes });
  expect((await page.request.get(`/review/${accepted.id}/download`)).status()).toBe(403);
  const reviewerContext = await browser.newContext();
  try {
    const reviewer = await reviewerContext.newPage();
    const email = await login(reviewer);
    await control(request, `/reviewer?email=${encodeURIComponent(email)}`);
    await reviewer.goto('/submissions');
    await expect(reviewer.getByText(accepted.title, { exact: true })).toHaveCount(0);
    await reviewer.goto('/review');
    const card = reviewer.locator(`[data-review-id="${accepted.id}"]`);
    const download = await reviewer.request.get(`/review/${accepted.id}/download`);
    expect(await download.body()).toEqual(bytes);
    const range = await reviewer.request.get(`/review/${accepted.id}/download`, { headers: { Range: 'bytes=2-8' } });
    expect(range.status()).toBe(206);
    expect(await range.body()).toEqual(bytes.subarray(2, 9));
    await card.getByRole('button', { name: 'Accept', exact: true }).click();
    const published = await terminal(request, accepted.id, 'published');
    expect(published.upstream_url).toContain('archive.org/download/');
    const archive = await (await request.get(controlOrigin + '/archive')).json();
    const object = archive.objects.find((o: { key: string }) => o.key.startsWith(published.ia_item + '/'));
    expect(object.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(await (await request.get(controlOrigin + '/archive/file?key=' + encodeURIComponent(object.key))).body()).toEqual(bytes);
    await control(request, `/test/redeliver?id=${accepted.id}`);
    await control(request, '/recover');
    expect((await (await request.get(controlOrigin + '/archive')).json()).writes).toBe(archive.writes);
    await reviewer.reload();
    await expect(reviewer.locator(`[data-review-id="${accepted.id}"]`)).toContainText('Published');

    const rejected = await upload(page, `Reject ${crypto.randomUUID()}`, { name: 'rejected.mp3', mimeType: 'audio/mpeg', buffer: bytes });
    await reviewer.reload();
    await reviewer.locator(`[data-review-id="${rejected.id}"]`).getByRole('button', { name: 'Reject', exact: true }).click();
    await terminal(request, rejected.id, 'rejected');
    expect((await (await request.get(controlOrigin + '/archive')).json()).writes).toBe(archive.writes);
    await control(request, `/reviewer?email=${encodeURIComponent(email)}&enabled=false`);
    expect((await reviewer.request.get('/review')).status()).toBe(403);
    expect((await reviewer.request.get(`/review/${rejected.id}/download`)).status()).toBe(403);
  } finally { await reviewerContext.close(); }
});

test('browser multipart upload and Archive multipart publication exceed 100 MiB', async ({ page, request }, testInfo) => {
  const email = await login(page);
  await control(request, `/reviewer?email=${encodeURIComponent(email)}`);
  const size = 101 * 1024 * 1024 + 1;
  const file = testInfo.outputPath('large.mp3');
  await mkdir(dirname(file), { recursive: true });
  const handle = await open(file, 'w');
  await handle.truncate(size); await handle.close();
  const putLengths: number[] = [];
  page.on('request', (r) => { if (r.method() === 'PUT') putLengths.push(Number(r.headers()['content-length'])); });
  const submitted = await upload(page, `Large ${crypto.randomUUID()}`, file);
  expect(putLengths).toHaveLength(7);
  expect(putLengths.reduce((sum, n) => sum + n, 0)).toBe(size);
  await page.goto('/review');
  await page.locator(`[data-review-id="${submitted.id}"]`).getByRole('button', { name: 'Accept', exact: true }).click();
  await terminal(request, submitted.id, 'published');
  const archive = await (await request.get(controlOrigin + '/archive')).json();
  const multipart = archive.uploads.find((u: { key: string }) => u.key.startsWith(submitted.ia_item + '/'));
  expect(multipart.completed).toBe(true);
  expect(Object.values(multipart.parts).map((part) => (part as { size: number }).size)).toEqual([64 * 1024 * 1024, size - 64 * 1024 * 1024]);
  expect(archive.objects.find((o: { key: string }) => o.key.startsWith(submitted.ia_item + '/')).size).toBe(size);
});

test('throttled publication retains media and scheduled recovery completes it', async ({ page, request }) => {
  const email = await login(page);
  await control(request, `/reviewer?email=${encodeURIComponent(email)}`);
  const submitted = await upload(page, `Retry ${crypto.randomUUID()}`, { name: 'retry.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('retry safely') });
  await control(request, '/archive/fault?mode=throttle&count=1');
  await page.goto('/review');
  await page.locator(`[data-review-id="${submitted.id}"]`).getByRole('button', { name: 'Accept', exact: true }).click();
  await expect.poll(async () => (await state(request)).jobs.find((j) => j.submission_id === submitted.id)?.last_error).toBe('archive_throttled');
  const retained = (await state(request)).uploads.find((u) => u.id === submitted.upload_id)!;
  expect(retained.object_present).toBe(true);
  expect(retained.status).toBe('staged');
  await control(request, '/recover?due=true');
  await terminal(request, submitted.id, 'published');
});

test('JSON errors retain form fields, and an expired session redirects fully', async ({ page, request }) => {
  const email = await login(page, uniqueEmail(), 'it');
  await page.locator('[name="title"]').fill('Titolo conservato');
  await page.locator('[name="notes"]').fill('Note conservate');
  await page.evaluate(async () => {
    await htmx.ajax('post', '/submissions', { target: '#submission-workspace', swap: 'outerHTML', values: { csrf_token: 'invalid', upload_id: 'missing' } });
  });
  await expect(page.locator('[data-request-error]')).toContainText('sessione');
  await expect(page.locator('[name="title"]')).toHaveValue('Titolo conservato');
  await expect(page.locator('[name="notes"]')).toHaveValue('Note conservate');
  await control(request, `/test/expire-session?email=${encodeURIComponent(email)}`);
  await page.locator('[data-nav-section="history"]').click();
  await page.waitForURL('http://localhost:8797/');
  await expect(page.locator('#auth-panel')).toBeVisible();
});

test('scheduled recovery aborts an abandoned upload and releases its reservation', async ({ page, request }) => {
  await login(page);
  const csrf = await page.locator('[name="csrf_token"]').first().inputValue();
  const response = await page.request.post('/uploads/authorize', { data: { csrf_token: csrf, title: 'Abandoned', notes: '', filename: 'voice.mp3', content_type: 'audio/mpeg', byte_size: 5, idempotency_key: crypto.randomUUID() } });
  expect(response.ok()).toBe(true);
  const { upload_id: id } = await response.json();
  await control(request, `/test/expire-upload?id=${id}`);
  await control(request, '/recover');
  await expect.poll(async () => (await state(request)).uploads.find((u) => u.id === id)?.status).toBe('released');
});
