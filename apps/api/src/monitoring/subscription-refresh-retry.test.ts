import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BootstrapAttempt } from '../bootstrap-attempt.js';
import { SubscriptionCoordinator } from './subscription-coordinator.js';
import { SubscriptionRefreshRetry } from './subscription-refresh-retry.js';

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((done, failed) => { resolve = done; reject = failed; });
  return { promise, resolve, reject };
};

describe('subscription refresh retry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it.each(['repository', 'provider'])('recovers from a transient %s failure without another mutation and keeps health honest', async failure => {
    let symbols = ['AAPL'];
    const repository = { union: vi.fn(async () => symbols) };
    const provider = { replaceSubscriptions: vi.fn(async (_symbols: string[]) => undefined) };
    const coordinator = new SubscriptionCoordinator(repository, provider);
    await coordinator.initialize(async () => undefined);
    const onSuccess = vi.fn();
    const onFailure = vi.fn();
    const retry = new SubscriptionRefreshRetry(coordinator, { initialDelayMs: 100, maxDelayMs: 400, onSuccess, onFailure });
    symbols = ['MSFT'];
    if (failure === 'repository') repository.union.mockRejectedValueOnce(new Error('database unavailable'));
    else provider.replaceSubscriptions.mockRejectedValueOnce(new Error('provider unavailable'));
    await retry.refresh();
    expect(coordinator.symbols()).toEqual(['AAPL']);
    expect(coordinator.isHealthy()).toBe(false);
    expect(onFailure).toHaveBeenCalledOnce();
    expect(onSuccess).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(99);
    expect(coordinator.symbols()).toEqual(['AAPL']);
    await vi.advanceTimersByTimeAsync(1);
    expect(coordinator.symbols()).toEqual(['MSFT']);
    expect(coordinator.isHealthy()).toBe(true);
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    retry.close();
  });

  it('coalesces changes across failures and caps exponential retry delays while applying the latest union', async () => {
    let symbols = ['AAPL'];
    const provider = { replaceSubscriptions: vi.fn(async (_symbols: string[]) => { throw new Error('unavailable'); }) };
    const coordinator = new SubscriptionCoordinator({ union: async () => symbols }, provider);
    const retry = new SubscriptionRefreshRetry(coordinator, { initialDelayMs: 100, maxDelayMs: 400 });
    await Promise.all([retry.refresh(), retry.refresh(), retry.refresh()]);
    expect(provider.replaceSubscriptions).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
    for (const delay of [100, 200, 400, 400]) {
      await Promise.all([retry.refresh(), retry.refresh()]);
      expect(vi.getTimerCount()).toBe(1);
      const before = provider.replaceSubscriptions.mock.calls.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(provider.replaceSubscriptions).toHaveBeenCalledTimes(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(provider.replaceSubscriptions).toHaveBeenCalledTimes(before + 1);
      expect(vi.getTimerCount()).toBe(1);
    }
    symbols = ['NVDA', 'MSFT'];
    provider.replaceSubscriptions.mockResolvedValueOnce(undefined);
    await vi.advanceTimersByTimeAsync(400);
    expect(coordinator.symbols()).toEqual(['MSFT', 'NVDA']);
    expect(vi.getTimerCount()).toBe(0);
    retry.close();
  });

  it('serializes changes arriving during a successful in-flight refresh and shares completion', async () => {
    let symbols = ['AAPL'];
    const pending = deferred();
    const provider = { replaceSubscriptions: vi.fn(async (_symbols: string[]) => { if (provider.replaceSubscriptions.mock.calls.length === 1) await pending.promise; }) };
    const coordinator = new SubscriptionCoordinator({ union: async () => symbols }, provider);
    const retry = new SubscriptionRefreshRetry(coordinator);
    const first = retry.refresh();
    await Promise.resolve();
    symbols = ['MSFT'];
    const second = retry.refresh();
    expect(second).toBe(first);
    pending.resolve();
    await Promise.all([first, second]);
    expect(provider.replaceSubscriptions.mock.calls).toEqual([[['AAPL']], [['MSFT']]]);
    expect(coordinator.symbols()).toEqual(['MSFT']);
    retry.close();
  });

  it('does not lose a request queued between the final pending check and shared promise settlement', async () => {
    let symbols = ['AAPL'];
    let lateRequest: Promise<void> | undefined;
    const provider = { replaceSubscriptions: vi.fn(async (_symbols: string[]) => undefined) };
    const coordinator = new SubscriptionCoordinator({ union: async () => symbols }, provider);
    const retry = new SubscriptionRefreshRetry(coordinator, { onSuccess: () => {
      if (symbols[0] === 'AAPL') queueMicrotask(() => { symbols = ['MSFT']; lateRequest = retry.refresh(); });
    } });
    await retry.refresh();
    await lateRequest;
    expect(provider.replaceSubscriptions.mock.calls).toEqual([[['AAPL']], [['MSFT']]]);
    expect(coordinator.symbols()).toEqual(['MSFT']);
    retry.close();
  });

  it('cancels the timer on close or bootstrap rollback and ignores later requests', async () => {
    const refresh = vi.fn(async () => { throw new Error('unavailable'); });
    const retry = new SubscriptionRefreshRetry({ refresh }, { initialDelayMs: 100 });
    const attempt = new BootstrapAttempt();
    attempt.defer(() => retry.close());
    await retry.refresh();
    expect(vi.getTimerCount()).toBe(1);
    await attempt.rollback();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    await retry.refresh();
    retry.close();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('does not publish or schedule retries when an in-flight attempt fails after close', async () => {
    const pending = deferred();
    const refresh = vi.fn(() => pending.promise);
    const onFailure = vi.fn();
    const retry = new SubscriptionRefreshRetry({ refresh }, { initialDelayMs: 100, onFailure });
    const request = retry.refresh();
    retry.close();
    pending.reject(new Error('unavailable'));
    await request;
    expect(vi.getTimerCount()).toBe(0);
    expect(onFailure).not.toHaveBeenCalled();
  });
});
