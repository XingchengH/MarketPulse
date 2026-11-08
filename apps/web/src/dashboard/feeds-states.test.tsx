import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SymbolSnapshot } from '../api';

let state: 'loading' | 'error' | 'data' = 'loading';
let rows: SymbolSnapshot[] = [];
vi.mock('../api', () => ({
  useOverviewQuery: () => ({ data: { provider: 'alpaca' } }),
  useSymbolsQuery: () => state === 'loading' ? ({ isLoading: true }) : state === 'error' ? ({ isError: true, refetch: vi.fn() }) : ({ data: { symbols: rows } }),
  useWatchlistQuery: () => ({ data: { watchlist: { entries: rows.map(row => ({ symbol: row.symbol, companyName: `${row.symbol} Inc.` })), used: rows.length, limit: 25 } } }),
  useRemoveWatchlistSymbolMutation: () => [vi.fn(), { isLoading: false }],
}));
import { FeedsPage } from './FeedsPage';

afterEach(cleanup);
const snapshot = (overrides: Partial<SymbolSnapshot> = {}): SymbolSnapshot => ({ symbol: 'AAPL', feed: 'iex', receivedMessagesPerSecond: 0, lastEventAt: null, observedLatency: { latest: 0, p95: 0 }, staleDurationMs: 0, providerErrors: 0, reconnects: 0, ...overrides });

describe('symbol REST states', () => {
  it.each([['loading', 'Loading symbols…'], ['error', 'Symbols are unavailable'], ['data', 'No symbols are being monitored']] as const)('renders %s state', (next, text) => { state = next; rows = []; render(<FeedsPage/>); expect(screen.getByText(text)).toBeInTheDocument(); });

  it('renders a missing clock as unavailable, never market closed', () => {
    state = 'data'; rows = [snapshot({ marketClock: null, marketClockStatus: 'unavailable' })];
    render(<FeedsPage/>);
    expect(screen.getAllByText('unavailable')).toHaveLength(2);
    expect(screen.queryByText('market closed')).not.toBeInTheDocument();
    expect(screen.getByTitle('Market clock unavailable; stale-data monitoring is paused')).toBeInTheDocument();
  });

  it('renders a degraded cached clock with its age tooltip', () => {
    state = 'data'; rows = [snapshot({ lastEventAt: new Date(0).toISOString(), marketClockStatus: 'degraded', marketClock: { isOpen: true, status: 'degraded', staleAgeMs: 42_000 } })];
    render(<FeedsPage/>);
    expect(screen.getAllByText('degraded')).toHaveLength(2);
    expect(screen.getByTitle('Using last known market clock (42s old)')).toBeInTheDocument();
  });
});
