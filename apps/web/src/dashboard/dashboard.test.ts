import { describe, expect, it, vi } from 'vitest';
import { api, type SymbolSnapshot } from '../api';
import { makeStore } from '../store';
import { bindSocket } from '../socket';
const row = (rate: number): SymbolSnapshot => ({ symbol: 'AAPL', receivedMessagesPerSecond: rate, lastEventAt: '2026-11-05T00:00:00.000Z', observedLatency: { latest: 4, p95: 6 }, staleDurationMs: 0 });
describe('dashboard realtime cache', () => {
  it('patches API 41 msg/s to socket 55 msg/s and invalidates visible resources on reconnect', async () => {
    const store = makeStore();
    await store.dispatch(api.util.upsertQueryData('symbols', undefined, { symbols: [row(41)] }));
    expect(api.endpoints.symbols.select()(store.getState()).data?.symbols[0].receivedMessagesPerSecond).toBe(41);
    const handlers = new Map<string, (...args: unknown[]) => void>(), manager = new Map<string, () => void>();
    const socket = { on: vi.fn((name: string, fn: (...args: unknown[]) => void) => { handlers.set(name, fn); return socket; }), close: vi.fn(), io: { on: vi.fn((name: string, fn: () => void) => { manager.set(name, fn); }) } };
    bindSocket(store, socket as never);
    handlers.get('symbols:snapshot')?.([row(55)]);
    expect(api.endpoints.symbols.select()(store.getState()).data?.symbols[0].receivedMessagesPerSecond).toBe(55);
    await store.dispatch(api.util.upsertQueryData('overview', undefined, { provider: 'alpaca', providerState: 'connected', symbols: ['AAPL'] }));
    manager.get('reconnect')?.();
    expect(api.endpoints.symbols.select()(store.getState()).status).toBe('uninitialized');
    expect(api.endpoints.overview.select()(store.getState()).status).toBe('uninitialized');
  });
});
