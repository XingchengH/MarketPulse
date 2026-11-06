import { describe, expect, it, vi } from 'vitest';
import { api, type SymbolSnapshot } from '../api';
import { makeStore } from '../store';
import { bindSocket } from '../socket';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { Provider } from 'react-redux';
import { FeedsPage } from './FeedsPage';
import { createElement } from 'react';
const row = (rate: number): SymbolSnapshot => ({ symbol: 'AAPL', feed: 'iex', receivedMessagesPerSecond: rate, lastEventAt: '2026-11-05T00:00:00.000Z', observedLatency: { latest: 4, p95: 6 }, staleDurationMs: 0, providerErrors: 0, reconnects: 0 });
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
  it('patches provider state into the overview cache', async () => {
    const store = makeStore(); await store.dispatch(api.util.upsertQueryData('overview', undefined, { provider:'alpaca', providerState:'connecting', symbols:[] }));
    const handlers = new Map<string, (...args: unknown[]) => void>(); const socket = { on: vi.fn((name:string, fn:(...args:unknown[])=>void) => { handlers.set(name,fn); return socket; }), close:vi.fn(), io:{on:vi.fn()} };
    bindSocket(store, socket as never); handlers.get('provider:state')?.({ state:'connected', at:'2026-11-05T00:00:00Z' });
    expect(api.endpoints.overview.select()(store.getState()).data?.providerState).toBe('connected');
  });
  it('renders REST 41 msg/s and then the socket 55 msg/s snapshot', async () => {
    const store = makeStore(); await store.dispatch(api.util.upsertQueryData('symbols', undefined, { symbols:[row(41)] })); await store.dispatch(api.util.upsertQueryData('overview', undefined, { provider:'alpaca', providerState:'connected', symbols:['AAPL'] }));
    const handlers = new Map<string, (...args: unknown[]) => void>(); const socket = { on: vi.fn((name:string, fn:(...args:unknown[])=>void) => { handlers.set(name,fn); return socket; }), close:vi.fn(), io:{on:vi.fn()} }; bindSocket(store,socket as never);
    render(createElement(Provider, { store, children: createElement(FeedsPage) })); expect(screen.getByText('41')).toBeInTheDocument(); expect(screen.getByText('IEX')).toBeInTheDocument(); handlers.get('symbols:snapshot')?.([row(55)]); await waitFor(() => expect(screen.getByText('55')).toBeInTheDocument()); cleanup();
  });
});
