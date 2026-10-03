import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'browser-tests',
  workers: 1,
  timeout: 120000,
  use: { baseURL: 'http://localhost:8797', channel: 'chrome', headless: true },
  webServer: {
    command: 'node scripts/local/start.mjs --test',
    url: 'http://localhost:8798/health',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
