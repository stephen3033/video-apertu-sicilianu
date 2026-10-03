import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, validateConfig } from './deployment-config.mjs';
import { secretPayload, runtimeSecrets } from './runtime-secrets.mjs';
const output = {
  environment: 'preview',
  account_id: 'a'.repeat(32),
  worker_name: 'vas-preview',
  database_id: '12345678-abcd-1234-abcd-123456789abc',
  database_name: 'vas-preview',
  bucket_name: 'vas-preview-staging',
  publication_queue: 'vas-preview-publication',
  dead_letter_queue: 'vas-preview-dead-letter',
  app_origin: 'https://preview.vas.test',
  email_from: 'login@vas.test',
};
test('generated deployment config validates and rejects unsafe substitutions', () => {
  const config = generate(output);
  assert.equal(config.vars.APP_ENV, 'preview');
  assert.equal(config.queues.consumers[0].max_concurrency, 2);
  for (const patch of [
    { database_id: '' },
    { database_id: '00000000-0000-0000-0000-000000000000' },
    { app_origin: 'http://localhost:8787' },
    { app_origin: 'https://*.vas.test' },
    { email_from: 'noreply@example.com' },
    { environment: 'local' },
    { account_id: 'REPLACE_ACCOUNT' },
  ])
    assert.throws(() => generate({ ...output, ...patch }));
  assert.throws(() =>
    validateConfig({
      ...config,
      vars: { ...config.vars, LOCAL_UPLOAD_ORIGIN: 'http://localhost:8788' },
    }),
  );
  assert.throws(() =>
    validateConfig({ ...config, vars: { ...config.vars, AUTH_CODE_SECRET: 'secret' } }),
  );
});
test('secret payload excludes deployment and administration credentials', () => {
  const env = Object.fromEntries(runtimeSecrets.map((key) => [key, `resolved-${key}`]));
  env.CLOUDFLARE_API_TOKEN = 'deployment';
  env.CLOUDFLARE_DATABASE_ADMIN_TOKEN = 'administration';
  env.UNRELATED = 'ignored';
  assert.deepEqual(Object.keys(secretPayload(env)), runtimeSecrets);
  assert.throws(() => secretPayload({ ...env, RESEND_API_KEY: 'op://unresolved/path/value' }));
});
