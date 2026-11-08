import { useState } from 'react';
import { useOverviewQuery, useRemoveWatchlistSymbolMutation, useSymbolsQuery, useWatchlistQuery, type ApiError, type SymbolSnapshot } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { Modal } from '../components/Modal';
import { FeedDrawer } from './FeedDrawer';

function health(snapshot: SymbolSnapshot) {
  if (!snapshot.lastEventAt || snapshot.marketClockStatus === 'unavailable') return 'unavailable';
  if (snapshot.marketClockStatus === 'degraded') return 'degraded';
  if (snapshot.marketClock && !snapshot.marketClock.isOpen) return 'healthy';
  if (snapshot.providerErrors > 0 || snapshot.reconnects > 0) return 'degraded';
  return 'healthy';
}

export function marketState(snapshot: SymbolSnapshot) {
  if (snapshot.marketClockStatus === 'unavailable' || !snapshot.marketClock) return 'unavailable';
  if (snapshot.marketClockStatus === 'degraded') return 'degraded';
  return snapshot.marketClock.isOpen ? 'open' : 'market_closed';
}

export function marketStateTitle(snapshot: SymbolSnapshot) {
  if (snapshot.marketClockStatus === 'unavailable' || !snapshot.marketClock) return 'Market clock unavailable; stale-data monitoring is paused';
  if (snapshot.marketClockStatus === 'degraded') return `Using last known market clock${snapshot.marketClock.staleAgeMs === undefined ? '' : ` (${Math.round(snapshot.marketClock.staleAgeMs / 1000)}s old)`}`;
  return 'Current market clock';
}

export function FeedsPage({ compact = false }: { compact?: boolean }) {
  const symbols = useSymbolsQuery(), overview = useOverviewQuery(), watchlist = useWatchlistQuery();
  const [selectedSymbol, setSelectedSymbol] = useState<string>();
  const [removal, setRemoval] = useState<string>();
  const [removeError, setRemoveError] = useState('');
  const [remove, removing] = useRemoveWatchlistSymbolMutation();
  if (symbols.isLoading || watchlist.isLoading) return <p className="loading-state">Loading symbols…</p>;
  if (symbols.isError) return <div className="error-state"><h2>Symbols are unavailable</h2><button className="button" onClick={() => void symbols.refetch()}>Retry</button></div>;
  if (watchlist.isError) return <div className="error-state"><h2>Watchlist is unavailable</h2><button className="button" onClick={() => void watchlist.refetch()}>Retry watchlist</button></div>;
  const entries = watchlist.data?.watchlist.entries ?? [];
  const allRows = entries.map(item => ({ ...item, snapshot: symbols.data?.symbols.find(row => row.symbol === item.symbol) }));
  const rows = compact ? allRows.slice(0, 6) : allRows;
  const selected = entries.some(item => item.symbol === selectedSymbol) ? symbols.data?.symbols.find(item => item.symbol === selectedSymbol) : undefined;
  const closeRemoval = () => { if (!removing.isLoading) { setRemoval(undefined); setRemoveError(''); } };
  const confirmRemoval = async () => {
    if (!removal || removing.isLoading) return;
    try { await remove(removal).unwrap(); setRemoval(undefined); setRemoveError(''); }
    catch (error) { setRemoveError((error as ApiError)?.data?.error?.message ?? 'Unable to remove this stock. Please try again.'); }
  };
  return <section className="panel feed-panel">
    <div className="panel-heading"><div><h2>Symbol monitor</h2><p>{overview.data?.provider ?? 'Market data'} · {rows.length} symbols</p></div></div>
    <div className="table-scroll"><table className="feeds-table"><thead><tr><th scope="col">Symbol</th><th scope="col">Feed</th><th scope="col">Market state</th><th scope="col" className="numeric">Latest price</th><th scope="col" className="numeric">Spread</th><th scope="col" className="numeric" title="Messages received by the API during the trailing one-second window.">Received msg/s</th><th scope="col" className="numeric" title="Time from provider timestamp to API receipt; measured, not network-only latency.">Observed latency</th><th scope="col">Last event</th><th scope="col" title="Health uses event availability, provider errors/reconnects, and market-open state. Event age is displayed separately and is not treated as stale while the market is closed.">Health</th>{!compact && <th scope="col">Actions</th>}</tr></thead>
      <tbody>{rows.map(item => { const row = item.snapshot; return <tr key={item.symbol} onClick={() => row && setSelectedSymbol(item.symbol)}>
        <td><button className="exchange-cell" disabled={!row} onClick={() => setSelectedSymbol(item.symbol)}><strong>{item.symbol}</strong></button><span className="feed-company-name">{item.companyName}</span></td>
        <td>{row?.feed?.toUpperCase() ?? 'Awaiting data'}</td><td title={row ? marketStateTitle(row) : 'Awaiting market data'}><StatusBadge value={row ? marketState(row) : 'unavailable'} /></td>
        <td className="numeric mono">{row?.latestTrade?.price?.toFixed(2) ?? '—'}</td><td className="numeric mono">{row?.spread?.toFixed(4) ?? '—'}</td><td className="numeric mono">{row?.receivedMessagesPerSecond ?? 0}</td><td className="numeric mono">{row ? `${row.observedLatency.latest.toFixed(0)} ms` : '—'}</td>
        <td title={row ? `${(row.staleDurationMs / 1000).toFixed(1)} seconds since the API received the last event` : undefined}>{row?.lastEventAt ? new Date(row.lastEventAt).toLocaleTimeString() : '—'}</td><td><StatusBadge value={row ? health(row) : 'unavailable'} /></td>
        {!compact && <td className="watchlist-actions"><button className="button" aria-label={`Remove ${item.symbol}`} onClick={event => { event.stopPropagation(); setRemoveError(''); setRemoval(item.symbol); }}>Remove</button></td>}
      </tr>; })}</tbody></table>
      {!rows.length && <div className="empty-state"><h3>No symbols are being monitored</h3><p>Search for a stock or company to start monitoring.</p></div>}
    </div>
    {selected && <FeedDrawer feed={selected} onClose={() => setSelectedSymbol(undefined)} />}
    {removal && <Modal title={`Remove ${removal} from your watchlist?`} onClose={closeRemoval}><p className="dialog-intro">You will stop monitoring {removal}. You can add it again using stock search.</p>{removeError && <p className="error-note" role="alert">{removeError}</p>}<div className="dialog-actions"><button className="button" disabled={removing.isLoading} onClick={closeRemoval}>Cancel</button><button className="button danger" disabled={removing.isLoading} aria-label={`Remove ${removal}`} onClick={() => void confirmRemoval()}>{removing.isLoading ? 'Removing…' : `Remove ${removal}`}</button></div></Modal>}
  </section>;
}
