import { spawnSync } from 'node:child_process';
const result = spawnSync('node_modules/.bin/wrangler', process.argv.slice(2), {
  stdio: 'inherit',
  env: { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' },
});
process.exit(result.status ?? 1);
