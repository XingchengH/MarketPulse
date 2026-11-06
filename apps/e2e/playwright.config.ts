import { defineConfig } from '@playwright/test';

process.env.NODE_ENV = 'test';
const apiPort = Number(process.env.E2E_API_PORT);
const webPort = Number(process.env.E2E_WEB_PORT);
if (!Number.isInteger(apiPort) || !Number.isInteger(webPort)) throw new Error('Run Playwright through the E2E package script so free ports are allocated');

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  use: { baseURL: `http://localhost:${webPort}`, trace: 'retain-on-failure' },
  webServer: { command: `pnpm --filter @marketpulse/web dev --port ${webPort}`, url: `http://127.0.0.1:${webPort}`, env: { VITE_API_TARGET: `http://127.0.0.1:${apiPort}` }, reuseExistingServer: false, timeout: 60_000 },
});
