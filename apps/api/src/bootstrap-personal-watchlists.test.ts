import { describe, expect, it, vi } from 'vitest';
import { BootstrapAttempt } from './bootstrap-attempt.js';
import { bootstrapPersonalWatchlists } from './bootstrap-personal-watchlists.js';
import { SubscriptionCoordinator } from './monitoring/subscription-coordinator.js';

const setup = () => {
  const initialized = new Set<string>();
  const order: string[] = [];
  const userIds = ['01', '02', '03'];
  const ensureIndexes = vi.fn(async () => { order.push('indexes'); });
  const usersMissingInitialization = vi.fn(async (after: string | undefined, limit: number) => userIds.filter(id => !initialized.has(id) && (!after || id > after)).slice(0, limit));
  const initializeUser = vi.fn(async (id: string) => { initialized.add(id); order.push(id); });
  const union = vi.fn(async () => { order.push('union'); return initialized.size ? ['msft', 'AAPL'] : []; });
  const provider = { connect: vi.fn(async (_symbols: string[]) => { order.push('connect'); }), disconnect: vi.fn(async () => undefined), replaceSubscriptions: vi.fn(async (_symbols: string[]) => undefined) };
  const dependencies = { ensureIndexes, usersMissingInitialization, initializeUser, provider, batchSize: 2 };
  const start = async () => {
    const attempt = new BootstrapAttempt();
    const coordinator = new SubscriptionCoordinator({ union }, provider);
    try {
      await bootstrapPersonalWatchlists({ ...dependencies, coordinator, attempt });
      attempt.commit();
      return coordinator;
    } catch (error) { await attempt.rollback(); throw error; }
  };
  return { ...dependencies, initialized, order, union, start };
};

describe('personal watchlist bootstrap', () => {
  it('creates indexes, initializes all missing users in ordered batches, then connects once to the union', async () => {
    const state = setup();
    const coordinator = await state.start();
    expect(state.order).toEqual(['indexes', '01', '02', '03', 'union', 'connect']);
    expect(state.usersMissingInitialization.mock.calls).toEqual([[undefined, 2], ['02', 2], ['03', 2]]);
    expect(state.union).toHaveBeenCalledOnce();
    expect(state.provider.connect).toHaveBeenCalledExactlyOnceWith(['AAPL', 'MSFT']);
    await coordinator.refresh();
    expect(state.provider.replaceSubscriptions).not.toHaveBeenCalled();
  });

  it('retries initialization idempotently after a partial batch failure before connecting', async () => {
    const state = setup();
    state.initializeUser.mockImplementationOnce(async id => { state.initialized.add(id); }).mockRejectedValueOnce(new Error('initialization failed'));
    await expect(state.start()).rejects.toThrow('initialization failed');
    expect(state.provider.connect).not.toHaveBeenCalled();
    expect(state.union).not.toHaveBeenCalled();
    await state.start();
    expect(state.initializeUser.mock.calls.map(([id]) => id)).toEqual(['01', '02', '02', '03']);
    expect(state.initialized.size).toBe(3);
    expect(state.provider.connect).toHaveBeenCalledOnce();
  });

  it('does not initialize or connect after index failure, and retries cleanly', async () => {
    const state = setup();
    state.ensureIndexes.mockRejectedValueOnce(new Error('index failed'));
    await expect(state.start()).rejects.toThrow('index failed');
    expect(state.initializeUser).not.toHaveBeenCalled();
    expect(state.provider.connect).not.toHaveBeenCalled();
    await state.start();
    expect(state.provider.connect).toHaveBeenCalledOnce();
  });

  it('does not connect after a failed union and disconnects a partially failed connection before retry', async () => {
    const state = setup();
    state.union.mockRejectedValueOnce(new Error('union failed'));
    await expect(state.start()).rejects.toThrow('union failed');
    expect(state.provider.connect).not.toHaveBeenCalled();
    state.provider.connect.mockRejectedValueOnce(new Error('partial connect failed'));
    await expect(state.start()).rejects.toThrow('partial connect failed');
    expect(state.provider.disconnect).toHaveBeenCalledOnce();
    await state.start();
    expect(state.provider.connect).toHaveBeenCalledTimes(2);
    expect(state.initializeUser).toHaveBeenCalledTimes(3);
  });
});
