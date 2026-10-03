import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { validateConfig } from './deployment-config.mjs';
const environment = process.argv[2];
if (!['preview', 'production'].includes(environment))
  throw new Error('Specify preview or production');
const config = `wrangler.${environment}.json`;
validateConfig(JSON.parse(readFileSync(config, 'utf8')));
if (process.argv[3] !== '--resolved') {
  const result = spawnSync(
    'op',
    [
      'run',
      '--env-file',
      process.env.VAS_ADMIN_REFS || '.env.admin',
      '--',
      'node',
      'scripts/remote-migrate.mjs',
      environment,
      '--resolved',
    ],
    { stdio: 'inherit' },
  );
  process.exit(result.status ?? 1);
}
if (
  !process.env.CLOUDFLARE_DATABASE_ADMIN_TOKEN ||
  process.env.CLOUDFLARE_DATABASE_ADMIN_TOKEN.startsWith('op://')
)
  throw new Error('Missing database administration token');
const result = spawnSync(
  'node_modules/.bin/wrangler',
  ['d1', 'migrations', 'apply', 'DB', '--remote', '--config', config],
  {
    stdio: 'inherit',
    env: { ...process.env, CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_DATABASE_ADMIN_TOKEN },
  },
);
process.exit(result.status ?? 1);
