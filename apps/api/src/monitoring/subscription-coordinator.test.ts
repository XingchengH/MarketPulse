import { describe, expect, it, vi } from 'vitest';
import { SubscriptionCoordinator } from './subscription-coordinator.js';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};

describe('SubscriptionCoordinator', () => {
  it('normalizes and deduplicates overlapping lists, retaining each symbol until its final reference is removed', async () => {
    const lists = new Map([['alice', [' msft ', 'aapl']], ['bob', ['AAPL']]]);
    const repository = { union: vi.fn(async () => [...lists.values()].flat()) };
    const provider = { replaceSubscriptions: vi.fn(async (_symbols: string[]) => undefined) };
    const coordinator = new SubscriptionCoordinator(repository, provider);
    await coordinator.refresh();
    expect(provider.replaceSubscriptions).toHaveBeenLastCalledWith(['AAPL', 'MSFT']);
    const exposed = coordinator.symbols(); exposed.push('MUTATED');
    expect(coordinator.symbols()).toEqual(['AAPL', 'MSFT']);
    await coordinator.refresh();
    lists.set('bob', []);
    await coordinator.refresh();
    expect(provider.replaceSubscriptions).toHaveBeenCalledTimes(1);
    lists.set('alice', ['MSFT']);
    await coordinator.refresh();
    expect(provider.replaceSubscriptions).toHaveBeenLastCalledWith(['MSFT']);
    lists.set('alice', []);
    await coordinator.refresh();
    expect(provider.replaceSubscriptions).toHaveBeenLastCalledWith([]);
    expect(provider.replaceSubscriptions).toHaveBeenCalledTimes(3);
  });

  it('serializes concurrent refreshes, coalesces requests and eventually applies the latest union', async () => {
    let symbols = ['AAPL'];
    const firstReplacement = deferred();
    const repository = { union: vi.fn(async () => [...symbols]) };
    const provider = { replaceSubscriptions: vi.fn(async (_symbols: string[]) => { if (provider.replaceSubscriptions.mock.calls.length === 1) await firstReplacement.promise; }) };
    const coordinator = new SubscriptionCoordinator(repository, provider);
    const first = coordinator.refresh();
    await vi.waitFor(() => expect(provider.replaceSubscriptions).toHaveBeenCalledTimes(1));
    symbols = ['MSFT'];
    const second = coordinator.refresh();
    symbols = ['NVDA', 'MSFT'];
    const third = coordinator.refresh();
    expect(provider.replaceSubscriptions).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
    firstReplacement.resolve();
    await Promise.all([first, second, third]);
    expect(repository.union).toHaveBeenCalledTimes(2);
    expect(provider.replaceSubscriptions.mock.calls).toEqual([[['AAPL']], [['MSFT', 'NVDA']]]);
    expect(coordinator.symbols()).toEqual(['MSFT', 'NVDA']);
  });

  it('retains the applied cache on provider failure and retries the authoritative union on the next refresh', async () => {
    let symbols = ['AAPL'];
    const provider = { replaceSubscriptions: vi.fn(async (_symbols: string[]) => undefined) };
    const coordinator = new SubscriptionCoordinator({ union: async () => symbols }, provider);
    await coordinator.refresh();
    symbols = ['MSFT'];
    provider.replaceSubscriptions.mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(coordinator.refresh()).rejects.toThrow('provider unavailable');
    expect(coordinator.symbols()).toEqual(['AAPL']);
    expect(coordinator.isHealthy()).toBe(false);
    await coordinator.refresh();
    expect(coordinator.symbols()).toEqual(['MSFT']);
    expect(coordinator.isHealthy()).toBe(true);
    expect(provider.replaceSubscriptions).toHaveBeenCalledTimes(3);
  });

  it('clears an unsuccessful union read so a later refresh can recover', async () => {
    const repository = { union: vi.fn().mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValueOnce(['AAPL']) };
    const provider = { replaceSubscriptions: vi.fn(async (_symbols: string[]) => undefined) };
    const coordinator = new SubscriptionCoordinator(repository, provider);
    await expect(coordinator.refresh()).rejects.toThrow('database unavailable');
    expect(provider.replaceSubscriptions).not.toHaveBeenCalled();
    await coordinator.refresh();
    expect(coordinator.symbols()).toEqual(['AAPL']);
  });

  it('reapplies the previous union after a failed replacement that may have partially changed the provider', async () => {
    let symbols = ['AAPL'];
    const provider = { replaceSubscriptions: vi.fn(async (_symbols: string[]) => undefined) };
    const coordinator = new SubscriptionCoordinator({ union: async () => symbols }, provider);
    await coordinator.refresh();
    symbols = ['MSFT'];
    provider.replaceSubscriptions.mockRejectedValueOnce(new Error('partial provider failure'));
    await expect(coordinator.refresh()).rejects.toThrow('partial provider failure');
    symbols = ['AAPL'];
    await coordinator.refresh();
    expect(provider.replaceSubscriptions).toHaveBeenCalledTimes(3);
    expect(provider.replaceSubscriptions).toHaveBeenLastCalledWith(['AAPL']);
  });

  it.each([{ symbols: [] }, { symbols: [' msft ', 'AAPL', 'aapl'] }])('connects once with the initial union $symbols and avoids an immediate replacement', async ({ symbols }) => {
    const repository = { union: vi.fn(async () => symbols) };
    const provider = { replaceSubscriptions: vi.fn(async (_symbols: string[]) => undefined) };
    const connect = vi.fn(async (_symbols: string[]) => undefined);
    const coordinator = new SubscriptionCoordinator(repository, provider);
    await coordinator.initialize(connect);
    expect(repository.union).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledExactlyOnceWith(symbols.length ? ['AAPL', 'MSFT'] : []);
    await coordinator.refresh();
    expect(provider.replaceSubscriptions).not.toHaveBeenCalled();
  });

  it('does not cache a failed initial connection and serializes refreshes during connection', async () => {
    let symbols = ['AAPL'];
    const pending = deferred();
    const provider = { replaceSubscriptions: vi.fn(async (_symbols: string[]) => undefined) };
    const coordinator = new SubscriptionCoordinator({ union: async () => symbols }, provider);
    await expect(coordinator.initialize(async () => { throw new Error('connect failed'); })).rejects.toThrow('connect failed');
    expect(coordinator.symbols()).toEqual([]);
    const connected = coordinator.initialize(async () => pending.promise);
    symbols = ['MSFT'];
    const refreshed = coordinator.refresh();
    pending.resolve();
    await Promise.all([connected, refreshed]);
    expect(provider.replaceSubscriptions).toHaveBeenCalledExactlyOnceWith(['MSFT']);
    expect(coordinator.symbols()).toEqual(['MSFT']);
  });
});
