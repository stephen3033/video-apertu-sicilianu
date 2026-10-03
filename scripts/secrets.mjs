import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { validateConfig } from './deployment-config.mjs';
import { secretPayload } from './runtime-secrets.mjs';
const environment = process.argv[2],
  refs = process.argv[3] || '.env';
if (!['preview', 'production'].includes(environment))
  throw new Error('Usage: npm run secrets:sync -- preview|production [references.env]');
const config = `wrangler.${environment}.json`;
validateConfig(JSON.parse(readFileSync(config, 'utf8')));
if (process.argv[4] !== '--resolved') {
  const child = spawnSync(
    'op',
    [
      'run',
      '--env-file',
      refs,
      '--',
      'node',
      'scripts/secrets.mjs',
      environment,
      refs,
      '--resolved',
    ],
    { stdio: 'inherit' },
  );
  process.exit(child.status ?? 1);
}
const values = secretPayload(process.env);
// Only the allowlisted runtime values reach Worker secrets, via stdin. Deployment
// and database-administration credentials never enter the JSON payload.
const result = spawnSync('node_modules/.bin/wrangler', ['secret', 'bulk', '--config', config], {
  input: JSON.stringify(values),
  stdio: ['pipe', 'inherit', 'inherit'],
  env: process.env,
});
process.exit(result.status ?? 1);
