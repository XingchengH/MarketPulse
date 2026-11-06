import { defineConfig } from '@playwright/test';

process.env.NODE_ENV = 'test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  use: { baseURL: 'http://127.0.0.1:43991', trace: 'retain-on-failure' },
  webServer: { command: 'pnpm --filter @marketpulse/web dev --port 43991', url: 'http://127.0.0.1:43991', reuseExistingServer: false, timeout: 60_000 },
});
