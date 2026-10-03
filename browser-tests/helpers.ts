import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { Job, Submission, Upload } from '../src/domain/models';
export const controlOrigin = 'http://localhost:8798';
export const uniqueEmail = () => `browser-${crypto.randomUUID()}@example.com`;
export async function control(request: APIRequestContext, path: string) {
  const response = await request.post(controlOrigin + path, { headers: { 'X-VAS-Local-Control': '1' } });
  expect(response.ok()).toBe(true);
  return response.json();
}
export async function state(request: APIRequestContext): Promise<{
  submissions: Submission[];
  uploads: (Upload & { object_present: boolean })[];
  jobs: (Job & { last_error: string | null })[];
  reserved_bytes: number;
}> {
  return (await request.get(controlOrigin + '/state')).json();
}
export async function login(page: Page, email = uniqueEmail(), locale = 'en') {
  await page.goto('/');
  await page.locator('[data-language-select]').selectOption(locale);
  await page.locator('[name="email"]').fill(email);
  await page.locator('#auth-panel button[type="submit"]').click();
  await expect(page.locator('[name="code"]')).toBeVisible();
  const delivery = await (await page.request.get(`${controlOrigin}/email?email=${encodeURIComponent(email)}`)).json();
  expect(delivery.locale).toBe(locale);
  await page.locator('[name="code"]').fill(delivery.code);
  await page.locator('form[action="/auth/code/verify"] button').click();
  await page.waitForURL('**/submissions/new');
  return email;
}
export async function upload(page: Page, title: string, file: string | { name: string; mimeType: string; buffer: Buffer }) {
  await page.goto('/submissions/new');
  await page.locator('[name="title"]').fill(title);
  await page.locator('[name="notes"]').fill('Una testimonianza siciliana.');
  await page.locator('[name="media"]').setInputFiles(file);
  await page.locator('[data-upload-form] button[type="submit"]').click();
  await expect(page.locator('.success-card')).toBeVisible({ timeout: 60000 });
  const submission = (await state(page.request)).submissions.find((s) => s.title === title);
  expect(submission).toBeTruthy();
  return submission!;
}
export async function terminal(request: APIRequestContext, id: string, lifecycle: string) {
  await expect.poll(async () => (await state(request)).submissions.find((s) => s.id === id)?.lifecycle, { timeout: 60000, intervals: [100, 250, 500] }).toBe(lifecycle);
  const current = await state(request);
  const submission = current.submissions.find((s) => s.id === id)!;
  const upload = current.uploads.find((u) => u.id === submission.upload_id)!;
  expect(upload.status).toBe('released');
  expect(upload.object_present).toBe(false);
  expect(current.jobs.find((j) => j.submission_id === id)?.state).toBe('done');
  return submission;
}
