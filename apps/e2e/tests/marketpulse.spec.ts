import { expect, test } from '@playwright/test';
import { startE2eHarness } from './harness.js';

test('real stack logs in an admin, streams IEX data, and persists acknowledgement', async ({ page }) => {
  const harness = await startE2eHarness();
  try {
    await page.goto('/');
    await page.getByRole('link', { name: 'Continue with Google' }).click();
    await expect(page.getByText('Test Admin')).toBeVisible();
    await expect(page.getByText('Connected to Alpaca IEX')).toBeVisible();

    await harness.waitForSocket();
    harness.provider.handle.emitTrade({ symbol: 'AAPL', price: 201.5, size: 3, providerTimestamp: '2026-11-05T17:00:00.000Z', receivedAt: '2026-11-05T17:00:00.040Z' });
    await new Promise(resolve => setTimeout(resolve, 50));
    harness.provider.handle.emitTrade({ symbol: 'AAPL', price: 201.5, size: 3, providerTimestamp: '2026-11-05T17:00:00.000Z', receivedAt: '2026-11-05T17:00:00.040Z' });
    await expect(page.getByRole('cell', { name: 'AAPL' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '40 ms' })).toBeVisible();

    await page.getByRole('link', { name: /Alert center/ }).click();
    await expect(page.getByText('AAPL · observedLatencyMs')).toBeVisible();
    await page.getByRole('button', { name: 'Acknowledge' }).click();
    await expect(page.getByText(/Acknowledged by/)).toBeVisible();
  } finally {
    await harness.stop();
  }
});
