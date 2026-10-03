import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { validateConfig } from './deployment-config.mjs';
const environment = process.argv[2];
if (!['preview', 'production'].includes(environment))
  throw new Error('Specify preview or production');
const config = `wrangler.${environment}.json`;
validateConfig(JSON.parse(readFileSync(config, 'utf8')));
const build = spawnSync('node', ['scripts/build.mjs'], { stdio: 'inherit' });
if (build.status) process.exit(build.status);
const result = spawnSync(
  'op',
  [
    'run',
    '--env-file',
    process.env.VAS_SECRET_REFS || '.env',
    '--',
    'node_modules/.bin/wrangler',
    'deploy',
    '--config',
    config,
    ...process.argv.slice(3),
  ],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
