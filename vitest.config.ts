import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          AUTH_CODE_SECRET: 'development-test-only-secret',
          EMAIL_BACKEND: 'test',
          MIGRATIONS: await readD1Migrations('./migrations/d1'),
        },
        queueConsumers: [],
        serviceBindings: { TEST_EMAIL: async () => new Response(null) },
      },
    }),
  ],
  test: {
    include: ['worker-tests/**/*.test.ts'],
    setupFiles: ['./worker-tests/setup.ts'],
    fileParallelism: false,
  },
});
