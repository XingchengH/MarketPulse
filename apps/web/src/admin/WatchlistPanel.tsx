import { useState, type FormEvent } from 'react';
import { useAddWatchlistSymbolMutation, useRemoveWatchlistSymbolMutation, useWatchlistQuery, type ApiError } from '../api';

const message = (error: unknown) => ((error as ApiError | undefined)?.data?.error?.message ?? 'Unable to update the watchlist');

export function WatchlistPanel() {
  const { data, isLoading, isError, refetch } = useWatchlistQuery();
  const [add, adding] = useAddWatchlistSymbolMutation();
  const [remove, removing] = useRemoveWatchlistSymbolMutation();
  const [symbol, setSymbol] = useState('');
  const [feedback, setFeedback] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setFeedback('');
    try { await add(symbol).unwrap(); setFeedback(`${symbol.trim().toUpperCase()} added`); setSymbol(''); }
    catch (error) { setFeedback(message(error)); await refetch(); }
  };
  const removeSymbol = async (value: string) => {
    setFeedback('');
    try { await remove(value).unwrap(); setFeedback(`${value} removed`); }
    catch (error) { setFeedback(message(error)); await refetch(); }
  };
  return <section className="panel admin-panel" aria-labelledby="watchlist-title"><div className="panel-heading"><div><h2 id="watchlist-title">Watchlist</h2><p>Symbols subscribed to the live market feed.</p></div></div><form className="inline-form" onSubmit={submit}><label htmlFor="watchlist-symbol">Symbol</label><input id="watchlist-symbol" value={symbol} onChange={event => setSymbol(event.target.value.toUpperCase())} required pattern="[A-Za-z][A-Za-z0-9.-]*"/><button className="primary-button" disabled={adding.isLoading}>Add symbol</button></form><p role="status" aria-live="polite">{feedback}</p>{isLoading && <p>Loading watchlist…</p>}{isError && <div className="error-state"><h3>Watchlist is unavailable</h3><button className="secondary-button" onClick={() => void refetch()}>Retry watchlist</button></div>}{data && <table><thead><tr><th scope="col">Symbol</th><th scope="col">Actions</th></tr></thead><tbody>{data.watchlist.map(item => <tr key={item.symbol}><td><strong>{item.symbol}</strong></td><td><button className="secondary-button" disabled={removing.isLoading || data.watchlist.length === 1} onClick={() => void removeSymbol(item.symbol)}>Remove <span className="sr-only">{item.symbol}</span></button></td></tr>)}</tbody></table>}</section>;
}
