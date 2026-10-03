import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const placeholder =
  /placeholder|replace[_ -]|example\.(?:com|org|net)|localhost|127\.0\.0\.1|00000000-0000|^0{32}$/i;
function required(value, name) {
  if (typeof value !== 'string' || !value || placeholder.test(value) || value.includes('op://'))
    throw new Error(`Missing or placeholder ${name}`);
  return value;
}
export function validateConfig(config) {
  if (!['preview', 'production'].includes(config.vars?.APP_ENV))
    throw new Error('Invalid deployment environment');
  if (!/^[a-f0-9]{32}$/.test(required(config.account_id, 'account ID')))
    throw new Error('Invalid account ID');
  const origin = new URL(required(config.vars.APP_ORIGIN, 'application origin'));
  if (
    origin.protocol !== 'https:' ||
    origin.origin !== config.vars.APP_ORIGIN ||
    origin.username ||
    origin.password ||
    origin.hostname.includes('*')
  )
    throw new Error('Use an exact HTTPS origin');
  for (const [key, value] of Object.entries(config.vars)) {
    if (/SECRET|API_KEY|ACCESS_KEY|TOKEN|REVIEWER|LOCAL|TEST/i.test(key))
      throw new Error(`Forbidden runtime variable ${key}`);
    required(value, key);
  }
  if (config.vars.EMAIL_BACKEND !== 'resend') throw new Error('Resend is required');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(required(config.vars.EMAIL_FROM, 'sender')))
    throw new Error('Invalid sender');
  if (!/^[0-9a-f-]{36}$/i.test(required(config.d1_databases?.[0]?.database_id, 'D1 ID')))
    throw new Error('Invalid D1 ID');
  for (const [key, value] of Object.entries({
    worker: config.name,
    database: config.d1_databases?.[0]?.database_name,
    bucket: config.r2_buckets?.[0]?.bucket_name,
    queue: config.queues?.producers?.[0]?.queue,
    dead_letter: config.vars.DEAD_LETTER_QUEUE,
  }))
    required(value, key);
  if (
    config.r2_buckets?.some((b) => b.remote) ||
    config.d1_databases?.some((b) => b.remote) ||
    config.dev
  )
    throw new Error('Local overrides cannot deploy');
  if (
    config.queues.consumers[0].max_batch_size !== 1 ||
    config.queues.consumers[0].max_concurrency !== 2 ||
    config.queues.consumers[0].max_retries !== 8 ||
    config.queues.consumers[0].dead_letter_queue !== config.vars.DEAD_LETTER_QUEUE
  )
    throw new Error('Unsafe queue configuration');
  if (
    config.vars.R2_ACCOUNT_ID !== config.account_id ||
    config.vars.R2_BUCKET_NAME !== config.r2_buckets[0].bucket_name
  )
    throw new Error('R2 identifiers disagree');
  return config;
}
export function generate(output) {
  const v = output.deployment?.value || output;
  const env = required(v.environment, 'environment');
  const config = {
    name: required(v.worker_name, 'worker'),
    main: 'src/entrypoints/worker.ts',
    account_id: required(v.account_id, 'account'),
    compatibility_date: '2026-08-01',
    compatibility_flags: ['nodejs_compat'],
    workers_dev: false,
    preview_urls: false,
    routes: [{ pattern: new URL(required(v.app_origin, 'origin')).hostname, custom_domain: true }],
    assets: { directory: './dist/public', binding: 'ASSETS', run_worker_first: true },
    d1_databases: [
      {
        binding: 'DB',
        database_name: v.database_name,
        database_id: v.database_id,
        migrations_dir: 'migrations/d1',
      },
    ],
    r2_buckets: [{ binding: 'STAGING_BUCKET', bucket_name: v.bucket_name }],
    queues: {
      producers: [{ binding: 'PUBLICATION_QUEUE', queue: v.publication_queue }],
      consumers: [
        {
          queue: v.publication_queue,
          max_batch_size: 1,
          max_batch_timeout: 1,
          max_retries: 8,
          max_concurrency: 2,
          dead_letter_queue: v.dead_letter_queue,
        },
        { queue: v.dead_letter_queue, max_batch_size: 1, max_batch_timeout: 1, max_concurrency: 1 },
      ],
    },
    triggers: { crons: ['*/5 * * * *'] },
    observability: { enabled: true },
    vars: {
      APP_ENV: env,
      APP_ORIGIN: v.app_origin,
      EMAIL_BACKEND: 'resend',
      EMAIL_FROM: v.email_from,
      R2_ACCOUNT_ID: v.account_id,
      R2_BUCKET_NAME: v.bucket_name,
      IA_ITEM_PREFIX: v.worker_name,
      DEAD_LETTER_QUEUE: v.dead_letter_queue,
    },
  };
  return validateConfig(config);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: node scripts/deployment-config.mjs terraform-output.json');
  const config = generate(JSON.parse(await readFile(file, 'utf8')));
  const path = `wrangler.${config.vars.APP_ENV}.json`;
  await writeFile(path, JSON.stringify(config, null, 2) + '\n');
  console.log(`Validated ${path}`);
}
