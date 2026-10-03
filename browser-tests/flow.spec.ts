import { test, expect } from '@playwright/test';
test('multilingual login, persistent navbar, direct upload, review and capacity', async ({
  page,
  request,
}) => {
  const pendingRequests: Promise<{ url: string; method: string; size: number }>[] = [];
  page.on('requestfinished', (r) =>
    pendingRequests.push(
      Promise.all([r.sizes(), r.allHeaders()]).then(([s, h]) => ({
        url: r.url(),
        method: r.method(),
        size: Number(h['content-length']) || s.requestBodySize,
      })),
    ),
  );
  await page.goto('/');
  await page.locator('[data-language-select]').selectOption('it');
  await expect(page.locator('h1')).toHaveText('Accedi o crea un account');
  const email = `browser-${crypto.randomUUID()}@example.com`;
  await page.locator('[name="email"]').fill(email);
  await page.locator('#auth-panel button[type="submit"]').click();
  await expect(page.locator('h1')).toHaveText('Controlla la tua email');
  const delivery = await (
    await request.get(`http://localhost:8798/email?email=${encodeURIComponent(email)}`)
  ).json();
  expect(delivery.locale).toBe('it');
  await page.locator('[name="code"]').fill(delivery.code);
  await page.getByRole('button', { name: 'Continua', exact: true }).click();
  await page.waitForURL('**/submissions/new');
  await expect(page.locator('[data-language-select]')).toHaveValue('it');
  const navbar = page.locator('[data-persistent-navbar]');
  await navbar.evaluate((el) => el.setAttribute('data-browser-identity', 'preserved'));
  await page.locator('[data-nav-section="history"]').click();
  await page.waitForURL('**/submissions');
  await expect(navbar).toHaveAttribute('data-browser-identity', 'preserved');
  await page.locator('[data-nav-section="new"]').click();
  await page.waitForURL('**/submissions/new');
  const data = Buffer.alloc(1024 * 1024 + 17, 65);
  await page.locator('[name="title"]').fill('Voce da Modica');
  await page.locator('[name="notes"]').fill('Una breve testimonianza.');
  await page
    .locator('[name="media"]')
    .setInputFiles({ name: 'testimony.mp4', mimeType: 'video/mp4', buffer: data });
  await page.locator('[data-upload-form] button[type="submit"]').click();
  await expect(page.locator('.success-card')).toBeVisible();
  await expect(page.locator('.success-card h2')).toHaveText('Caricamento completato');
  await expect(navbar).toHaveAttribute('data-browser-identity', 'preserved');
  const requests = await Promise.all(pendingRequests);
  expect(
    requests
      .filter((r) => r.method === 'PUT')
      .map((r) => ({ origin: new URL(r.url).origin, size: r.size })),
  ).toEqual([{ origin: 'http://localhost:8798', size: data.length }]);
  expect(
    requests
      .filter((r) => r.method === 'POST' && r.url.startsWith('http://localhost:8797'))
      .every((r) => r.size < 32768),
  ).toBe(true);
  await page.locator('[data-nav-section="history"]').click();
  await expect(page.getByText('Voce da Modica', { exact: true })).toBeVisible();
  await page.goBack();
  await expect(navbar).toHaveAttribute('data-browser-identity', 'preserved');
  await request.post(`http://localhost:8798/reviewer?email=${encodeURIComponent(email)}`, { headers: { 'X-VAS-Local-Control': '1' } });
  await page.reload();
  await page.locator('[data-nav-section="review"]').click();
  await page.waitForURL('**/review');
  const card = page.locator('[data-review-id]').first();
  await expect(card).toContainText('testimony.mp4');
  const href = await card.getByRole('link', { name: 'Scarica' }).getAttribute('href');
  const downloaded = await page.request.get(href!);
  expect(downloaded.status()).toBe(200);
  expect((await downloaded.body()).length).toBe(data.length);
  await card.getByRole('button', { name: 'Accetta', exact: true }).click();
  await expect(page.locator('[data-review-id]').first()).toContainText('Accettato');
  await expect(
    page.locator('[data-review-id]').first().getByRole('button', { name: 'Rifiuta', exact: true }),
  ).toHaveCount(0);
  await page.locator('[data-nav-section="new"]').click();
  await page.locator('[name="title"]').fill('Da rifiutare');
  await page
    .locator('[name="media"]')
    .setInputFiles({ name: 'second.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('voice') });
  await page.locator('[data-upload-form] button[type="submit"]').click();
  await expect(page.locator('.success-card')).toBeVisible();
  await page.locator('[data-nav-section="review"]').click();
  const rejected = page.locator('[data-review-id]').filter({ hasText: 'Da rifiutare' });
  await rejected.getByRole('button', { name: 'Rifiuta', exact: true }).click();
  await expect.poll(async () => { await page.reload(); return await page.locator('[data-review-id]').filter({ hasText: 'Da rifiutare' }).innerText(); }).toContain('Rifiutato');
  await request.post('http://localhost:8798/capacity?enabled=false', { headers: { 'X-VAS-Local-Control': '1' } });
  await page.locator('[data-nav-section="new"]').click();
  await page.locator('[name="title"]').fill('Capacity');
  await page
    .locator('[name="media"]')
    .setInputFiles({ name: 'third.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('voice') });
  await page.locator('[data-upload-form] button[type="submit"]').click();
  await expect(page.locator('[data-upload-error]')).toContainText('Lo spazio è pieno');
  await page.locator('[data-language-select]').selectOption('scn');
  await expect(page.locator('h1')).toHaveText('Càrrica un file');
  await page.locator('.account-tools form button').click();
  await page.waitForURL('http://localhost:8797/');
  await expect(page.locator('#auth-panel h1')).toHaveText('Trasi o crìa un cuntu');
});
