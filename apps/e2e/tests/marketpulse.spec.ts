import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { startE2eHarness } from './harness.js';
import { cleanupAll, type ExistingFailure } from './cleanup.js';

const starterUnion = ['AAPL', 'AMZN', 'META', 'MSFT', 'NVDA', 'TSLA'];
const amdUnion = ['AAPL', 'AMD', 'AMZN', 'META', 'MSFT', 'NVDA', 'TSLA'];
const bothPrivateUnion = ['AAPL', 'AMD', 'AMZN', 'GOOG', 'META', 'MSFT', 'NVDA', 'TSLA'];
const googUnion = ['AAPL', 'AMZN', 'GOOG', 'META', 'MSFT', 'NVDA', 'TSLA'];

test('real stack logs in an admin, streams IEX data, and persists acknowledgement', async ({ page }) => {
  const harness = await startE2eHarness();
  let failure: ExistingFailure | undefined;
  try {
    await page.goto('/');
    await page.getByRole('link', { name: 'Continue with Google' }).click();
    await expect(page.getByText('Test Admin')).toBeVisible();
    await expect(page.getByText('Connected to Alpaca IEX')).toBeVisible();

    await expect(page.getByRole('button', { name: 'AAPL', exact: true })).toBeVisible();
    await harness.waitForSocket();
    const received = Date.now();
    harness.provider.handle.emitTrade({ symbol: 'AAPL', price: 201.5, size: 3, providerTimestamp: new Date(received - 40).toISOString(), receivedAt: new Date(received).toISOString() });
    await expect(page.getByRole('cell', { name: '40 ms' })).toBeVisible();

    await page.getByRole('link', { name: /Alert center/ }).click();
    await expect(page.getByText('AAPL · observedLatencyMs')).toBeVisible();
    await page.getByRole('button', { name: 'Acknowledge' }).click();
    await expect(page.getByText(/Acknowledged by/)).toBeVisible();
    await page.reload();
    await expect(page.getByText(/Acknowledged by/)).toBeVisible();
  } catch (error) {
    failure = { error };
    throw error;
  } finally {
    await cleanupAll([() => harness.stop(), () => page.close()], failure);
  }
});

test('independent Google sessions keep personal watchlists and realtime delivery private', async ({ browser, baseURL }) => {
  const harness = await startE2eHarness();
  const contexts: BrowserContext[] = [];
  let failure: ExistingFailure | undefined;
  try {
    const contextA = await browser.newContext({ baseURL });
    contexts.push(contextA);
    const contextB = await browser.newContext({ baseURL });
    contexts.push(contextB);
    await harness.selectIdentity(contextA!, 'userA');
    await harness.selectIdentity(contextB!, 'userB');
    const [userA, userB] = await Promise.all(contexts.map(context => context.newPage()));
    const delivered = [new Set<string>(), new Set<string>()];
    for (const [index, page] of [userA!, userB!].entries()) page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
      const frame = String(payload);
      if (!frame.startsWith('42[')) return;
      const [event, snapshots] = JSON.parse(frame.slice(2));
      if (event === 'symbols:snapshot') for (const snapshot of snapshots) delivered[index]!.add(snapshot.symbol);
    }));
    async function login(page: Page, name: string) {
      await page.goto('/');
      await page.getByRole('link', { name: 'Continue with Google' }).click();
      await expect(page.getByRole('button', { name: `Account menu for ${name}` })).toBeVisible();
      await page.getByRole('link', { name: 'Live feeds' }).click();
      await expect(page.getByRole('button', { name: 'AAPL', exact: true })).toBeVisible();
    }
    await login(userA!, 'User Alpha');
    await login(userB!, 'User Beta');
    const sessionA = await (await contextA!.request.get('/api/auth/me')).json();
    const sessionB = await (await contextB!.request.get('/api/auth/me')).json();
    expect(sessionA.user.id).not.toBe(sessionB.user.id);
    expect(harness.subscriptionHistory).toEqual([starterUnion]);

    await userA!.getByRole('searchbox', { name: 'Search stocks or companies' }).fill('Advanced Micro');
    await userA!.getByRole('button', { name: 'Add AMD', exact: true }).click();
    await expect(userA!.getByRole('button', { name: 'AMD', exact: true })).toBeVisible();
    expect(harness.subscriptionHistory).toEqual([starterUnion, amdUnion]);
    await userB!.getByRole('searchbox', { name: 'Search stocks or companies' }).fill('GOOG');
    await userB!.getByRole('button', { name: 'Add GOOG', exact: true }).click();
    await expect(userB!.getByRole('button', { name: 'GOOG', exact: true })).toBeVisible();
    await harness.waitForSocket('userA', ['AAPL', 'AMD'], ['GOOG']);
    await harness.waitForSocket('userB', ['AAPL', 'GOOG'], ['AMD']);
    expect(harness.subscriptionHistory).toEqual([starterUnion, amdUnion, bothPrivateUnion]);

    for (const [symbol, price] of [['AAPL', 201.5], ['AMD', 155.25], ['GOOG', 180.75]] as const) {
      const received = Date.now();
      harness.provider.handle.emitTrade({ symbol, price, size: 3, providerTimestamp: new Date(received - 40).toISOString(), receivedAt: new Date(received).toISOString() });
    }
    for (const page of [userA!, userB!]) await expect(page.getByRole('row').filter({ has: page.getByRole('button', { name: 'AAPL', exact: true }) })).toContainText('201.50');
    await expect(userA!.getByRole('row').filter({ has: userA!.getByRole('button', { name: 'AMD', exact: true }) })).toContainText('155.25');
    await expect(userB!.getByRole('row').filter({ has: userB!.getByRole('button', { name: 'GOOG', exact: true }) })).toContainText('180.75');
    await expect.poll(() => [...delivered[0]!].sort()).toEqual(['AAPL', 'AMD']);
    await expect.poll(() => [...delivered[1]!].sort()).toEqual(['AAPL', 'GOOG']);
    await expect(userA!.getByRole('button', { name: 'GOOG', exact: true })).toHaveCount(0);
    await expect(userB!.getByRole('button', { name: 'AMD', exact: true })).toHaveCount(0);
    expect((await contextA!.request.get('/api/symbols/GOOG')).status()).toBe(404);
    expect((await contextB!.request.get('/api/symbols/AMD')).status()).toBe(404);
    expect((await contextA!.request.get('/api/metrics?symbol=GOOG&interval=1m')).status()).toBe(404);
    const symbolsA = await (await contextA!.request.get('/api/symbols')).json();
    const symbolsB = await (await contextB!.request.get('/api/symbols')).json();
    expect(symbolsA.symbols.map((entry: { symbol: string }) => entry.symbol)).not.toContain('GOOG');
    expect(symbolsB.symbols.map((entry: { symbol: string }) => entry.symbol)).not.toContain('AMD');
    // The detail UI is a drawer; direct navigation to its API URL must fail too.
    const forbidden = await userA!.goto('/api/symbols/GOOG');
    expect(forbidden?.status()).toBe(404);
    await expect(userA!.locator('body')).toContainText('not found');
    await userA!.goto('/feeds');
    await expect(userA!.getByRole('button', { name: 'AMD', exact: true })).toBeVisible();
    await userA!.getByRole('button', { name: 'Remove AMD', exact: true }).click();
    await userA!.getByRole('dialog').getByRole('button', { name: 'Remove AMD', exact: true }).click();
    await expect(userA!.getByRole('button', { name: 'AMD', exact: true })).toHaveCount(0);
    await userA!.reload();
    await expect(userA!.getByRole('heading', { name: 'Your watchlist' })).toBeVisible();
    await expect(userA!.getByRole('button', { name: 'AMD', exact: true })).toHaveCount(0);
    const persisted = await (await contextA!.request.get('/api/watchlist')).json();
    expect(persisted.watchlist.entries.map((entry: { symbol: string }) => entry.symbol)).not.toContain('AMD');
    expect(harness.subscriptionHistory).toEqual([starterUnion, amdUnion, bothPrivateUnion, googUnion]);
    await harness.waitForSocket('userA', ['AAPL'], ['AMD', 'GOOG']);

    await userA!.getByRole('button', { name: 'Account menu for User Alpha' }).click();
    await userA!.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(userA!.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
    expect((await contextA!.request.get('/api/auth/me')).status()).toBe(401);
    expect((await contextB!.request.get('/api/auth/me')).status()).toBe(200);

    // Select the next fake OAuth identity in-process, then exercise the real switch flow.
    await harness.selectIdentity(contextB!, 'userA');
    const chooser = userB!.waitForRequest(request => request.url().includes('/api/auth/google?select_account=true'));
    await userB!.getByRole('button', { name: 'Account menu for User Beta' }).click();
    await userB!.getByRole('menuitem', { name: 'Switch account', exact: true }).click();
    await chooser;
    await expect(userB!.getByRole('button', { name: 'Account menu for User Alpha' })).toBeVisible();
    await userB!.goto('/feeds');
    await expect(userB!.getByRole('button', { name: 'AAPL', exact: true })).toBeVisible();
    await expect(userB!.getByRole('button', { name: 'GOOG', exact: true })).toHaveCount(0);
    await expect(userB!.getByRole('button', { name: 'AMD', exact: true })).toHaveCount(0);
  } catch (error) {
    failure = { error };
    throw error;
  } finally {
    await cleanupAll([() => harness.stop(), ...contexts.map(context => () => context.close())], failure);
  }
});
