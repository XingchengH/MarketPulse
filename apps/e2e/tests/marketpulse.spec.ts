import { expect, test } from '@playwright/test';
import { createE2eHarness } from './harness.js';

test('admin observes an IEX trade and acknowledges the resulting alert', async ({ page }) => {
  const harness = createE2eHarness();
  await harness.install(page);
  await page.goto('/');
  await page.getByRole('link', { name: 'Continue with Google' }).click();
  await expect(page.getByText('Test Admin')).toBeVisible();

  harness.provider.handle.emitTrade({ symbol: 'AAPL', price: 201.5, size: 3, providerTimestamp: '2026-11-05T17:00:00.000Z', receivedAt: '2026-11-05T17:00:00.040Z' });
  await page.reload();
  await expect(page.getByText('Connected to Alpaca IEX')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'AAPL' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Observed latency' })).toBeVisible();

  await page.getByRole('link', { name: /Alert center/ }).click();
  await page.getByRole('button', { name: 'Acknowledge' }).click();
  await expect(page.getByText('Acknowledged by Test Admin')).toBeVisible();
});
