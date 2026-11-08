import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersonalWatchlist, WatchlistEntry } from '@marketpulse/contracts';
import { api } from '../api';
import { makeStore } from '../store';
import { AssetSearch } from './AssetSearch';
import { WatchlistWorkspace } from './WatchlistWorkspace';
import { FeedsPage } from '../dashboard/FeedsPage';

const entry = (symbol = 'AAPL'): WatchlistEntry => ({ id: symbol, symbol, companyName: `${symbol} Incorporated`, exchange: 'NASDAQ', assetClass: 'us_equity', createdAt: '2026-11-01T00:00:00.000Z' });
const list = (entries: WatchlistEntry[] = []): PersonalWatchlist => ({ entries, used: entries.length, limit: 25 });
const asset = (symbol = 'AAPL', inWatchlist = false) => ({ ...entry(symbol), tradable: true, inWatchlist });
let personal = list();
let searchError = false;
let addError = false;
let removeError = false;
let watchlistError = false;
let fetchMock: ReturnType<typeof vi.fn>;
const response = (data: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => data });
function mount(node: React.ReactNode) { const store = makeStore(); render(<Provider store={store}>{node}</Provider>); return store; }
const requests = (path: string) => fetchMock.mock.calls.filter(([url]) => String(url).startsWith(path));
const settle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(20); }); };

beforeEach(() => {
  personal = list(); searchError = false; addError = false; removeError = false; watchlistError = false;
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url.startsWith('/api/assets/search')) return searchError ? response({ error: { message: 'Asset search is temporarily unavailable' } }, 503) : response({ results: [asset()] });
    if (url.startsWith('/api/watchlist/') && init?.method === 'DELETE') {
      if (removeError) return response({ error: { message: 'Unable to remove this stock' } }, 503);
      personal = list(personal.entries.filter(item => item.symbol !== decodeURIComponent(url.split('/').at(-1)!)));
      return response({ watchlist: personal });
    }
    if (url === '/api/watchlist' && init?.method === 'POST') {
      if (addError) return response({ error: { message: 'Watchlist limit of 25 symbols reached' } }, 409);
      personal = list([...personal.entries, entry(JSON.parse(String(init.body)).symbol)]); return response({ watchlist: personal }, 201);
    }
    if (url === '/api/watchlist') return watchlistError ? response({ error: { message: 'Service unavailable' } }, 503) : response({ watchlist: personal });
    if (url === '/api/symbols') return response({ symbols: personal.entries.map(item => ({ symbol: item.symbol, feed: null, receivedMessagesPerSecond: 0, lastEventAt: null, observedLatency: { latest: 0, p95: 0 }, staleDurationMs: 0, providerErrors: 0, reconnects: 0 })) });
    if (url === '/api/overview') return response({ provider: 'alpaca', providerState: 'connected', symbols: personal.entries.map(item => item.symbol) });
    if (url.startsWith('/api/alerts')) return response({ alerts: [] });
    if (url === '/api/audit') return response({ events: [] });
    return response({ metrics: [] });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('asset search', () => {
  beforeEach(() => vi.useFakeTimers());
  it('skips short queries, debounces ticker and company queries for 300ms, and cleans up timers', async () => {
    mount(<AssetSearch watchlist={list()} />);
    const input = screen.getByRole('searchbox', { name: /stocks or companies/i });
    fireEvent.change(input, { target: { value: 'A' } });
    await act(async () => vi.advanceTimersByTime(400));
    expect(requests('/api/assets/search')).toHaveLength(0);
    fireEvent.change(input, { target: { value: 'AA' } });
    await act(async () => vi.advanceTimersByTime(299));
    expect(requests('/api/assets/search')).toHaveLength(0);
    await act(async () => vi.advanceTimersByTime(1)); await settle();
    expect(fetchMock).toHaveBeenCalledWith('/api/assets/search?q=AA', expect.anything());
    fireEvent.change(input, { target: { value: 'Apple' } });
    await act(async () => vi.advanceTimersByTime(300)); await settle();
    expect(fetchMock).toHaveBeenCalledWith('/api/assets/search?q=Apple', expect.anything());
    fireEvent.change(input, { target: { value: 'Microsoft' } }); cleanup();
    await act(async () => vi.advanceTimersByTime(300));
    expect(requests('/api/assets/search')).toHaveLength(2);
  });

  it('renders results and adds once while pending, retaining the query and updating membership', async () => {
    mount(<WatchlistWorkspace />); await settle();
    expect(requests('/api/watchlist').filter(([, options]) => options.method === undefined)).toHaveLength(1);
    const input = screen.getByRole('searchbox', { name: /stocks or companies/i });
    fireEvent.change(input, { target: { value: 'Apple' } });
    await act(async () => vi.advanceTimersByTime(300)); await settle();
    expect(screen.getByText('AAPL Incorporated')).toBeInTheDocument(); expect(screen.getByText('NASDAQ')).toBeInTheDocument();
    const add = screen.getByRole('button', { name: 'Add AAPL' });
    fireEvent.click(add); fireEvent.click(add); await settle();
    expect(requests('/api/watchlist').filter(([, options]) => options.method === 'POST')).toHaveLength(1);
    expect(requests('/api/watchlist').find(([, options]) => options.method === 'POST')?.[1].body).toBe(JSON.stringify({ symbol: 'AAPL' }));
    expect(screen.getByRole('button', { name: 'In watchlist' })).toBeDisabled();
    expect(input).toHaveValue('Apple');
  });

  it('shows an add error inline, retains the query, and leaves membership unchanged', async () => {
    addError = true; mount(<WatchlistWorkspace />); await settle();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Apple' } });
    await act(async () => vi.advanceTimersByTime(300)); await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Add AAPL' })); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('Watchlist limit of 25 symbols reached');
    expect(screen.getByRole('searchbox')).toHaveValue('Apple');
    expect(screen.getByText('0/25')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add AAPL' })).toBeEnabled();
  });

  it('shows exact member and limit labels', async () => {
    const store = makeStore();
    const view = render(<Provider store={store}><AssetSearch watchlist={list([entry()])} /></Provider>);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'AA' } });
    await act(async () => vi.advanceTimersByTime(300)); await settle();
    expect(screen.getByRole('button', { name: 'In watchlist' })).toBeDisabled();
    view.rerender(<Provider store={store}><AssetSearch watchlist={{ entries: [], used: 25, limit: 25 }} /></Provider>);
    await settle();
    expect(screen.getByRole('button', { name: 'Limit reached' })).toBeDisabled();
  });

  it('retains a failed query for provider retry, and distinguishes loading and no results', async () => {
    searchError = true; mount(<AssetSearch watchlist={list()} />);
    const input = screen.getByRole('searchbox'); fireEvent.change(input, { target: { value: 'Apple' } });
    await act(async () => vi.advanceTimersByTime(300)); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent('Asset search is temporarily unavailable');
    expect(input).toHaveValue('Apple'); searchError = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry search' })); await settle();
    expect(screen.getByRole('button', { name: 'Add AAPL' })).toHaveTextContent('Add');
    let resolve!: (value: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    fireEvent.change(input, { target: { value: 'Unknown' } }); await act(async () => vi.advanceTimersByTime(300));
    expect(screen.getByRole('status')).toHaveTextContent('Searching');
    await act(async () => { resolve(await response({ results: [] })); }); await settle();
    expect(screen.getByText('No stocks or companies found.')).toBeInTheDocument();
  });
});

describe('personal watchlist workspace', () => {
  it('retries watchlist failure without showing an empty-list prompt or duplicate errors', async () => {
    watchlistError = true;
    mount(<WatchlistWorkspace />);
    const retry = await screen.findByRole('button', { name: 'Retry watchlist' });
    expect(screen.queryByText('Search for a stock or company to start monitoring.')).not.toBeInTheDocument();
    watchlistError = false; fireEvent.click(retry);
    expect(await screen.findByRole('searchbox', { name: /stocks or companies/i })).toBeInTheDocument();
  });

  it('renders personal metadata while awaiting snapshots and excludes unrelated cached snapshots', async () => {
    personal = list([entry()]); const store = mount(<WatchlistWorkspace />);
    await screen.findByText('AAPL Incorporated');
    await act(async () => { await store.dispatch(api.util.upsertQueryData('symbols', undefined, { symbols: [{ symbol: 'PRIVATE', feed: 'iex', receivedMessagesPerSecond: 999, lastEventAt: null, observedLatency: { latest: 0, p95: 0 }, staleDurationMs: 0, providerErrors: 0, reconnects: 0 }] })); });
    expect(screen.getByText('AAPL Incorporated')).toBeInTheDocument();
    expect(screen.getByText('Awaiting data')).toBeInTheDocument();
    expect(screen.queryByText('PRIVATE')).not.toBeInTheDocument(); expect(screen.queryByText('999')).not.toBeInTheDocument();
  });

  it('shows the empty prompt and a 6/25 counter', async () => {
    const store = mount(<WatchlistWorkspace />);
    expect(await screen.findByText('Search for a stock or company to start monitoring.')).toBeInTheDocument();
    personal = list(['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOG', 'META'].map(symbol => entry(symbol)));
    store.dispatch(api.util.invalidateTags(['Watchlist', 'Symbols']));
    expect(await screen.findByText('6/25')).toBeInTheDocument();
    expect(await screen.findByText('AAPL Incorporated')).toBeInTheDocument();
  });

  it('confirms removal without opening a drawer, reports failure, then closes on success', async () => {
    personal = list([entry()]); mount(<WatchlistWorkspace />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove AAPL' }));
    const dialog = screen.getByRole('dialog'); expect(dialog).toHaveTextContent('AAPL'); expect(screen.queryByRole('heading', { name: 'AAPL details' })).not.toBeInTheDocument();
    expect(requests('/api/watchlist/')).toHaveLength(0);
    removeError = true; fireEvent.click(within(dialog).getByRole('button', { name: 'Remove AAPL' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Unable to remove this stock');
    removeError = false; fireEvent.click(within(dialog).getByRole('button', { name: 'Remove AAPL' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('0/25')).toBeInTheDocument();
    expect(requests('/api/watchlist/').every(([, options]) => options.method === 'DELETE')).toBe(true);
  });

  it('keeps compact overview to six with company names and no search or remove controls', async () => {
    personal = list(['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOG', 'META', 'TSLA'].map(symbol => entry(symbol)));
    mount(<FeedsPage compact />);
    expect(await screen.findByText('AAPL Incorporated')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'TSLA' })).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
  });

  it.each(['addWatchlistSymbol', 'removeWatchlistSymbol'] as const)('%s invalidates all personal resources', async endpoint => {
    const store = makeStore();
    await Promise.all([
      store.dispatch(api.endpoints.watchlist.initiate()), store.dispatch(api.endpoints.overview.initiate()),
      store.dispatch(api.endpoints.symbols.initiate()), store.dispatch(api.endpoints.alerts.initiate()), store.dispatch(api.endpoints.audit.initiate()),
    ]);
    fetchMock.mockClear();
    await store.dispatch(api.endpoints[endpoint].initiate('AAPL'));
    await waitFor(() => { for (const path of ['/api/watchlist', '/api/overview', '/api/symbols', '/api/alerts', '/api/audit']) expect(requests(path).filter(([, options]) => options.method === undefined).length).toBeGreaterThan(0); });
    store.dispatch(api.util.resetApiState());
  });
});
