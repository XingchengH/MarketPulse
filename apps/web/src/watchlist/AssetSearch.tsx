import { useEffect, useId, useRef, useState } from 'react';
import type { PersonalWatchlist } from '@marketpulse/contracts';
import { useAddWatchlistSymbolMutation, useAssetSearchQuery, type ApiError } from '../api';

export function AssetSearch({ watchlist }: { watchlist: PersonalWatchlist }) {
  const inputId = useId();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [feedback, setFeedback] = useState('');
  const pending = useRef(false);
  const [add, adding] = useAddWatchlistSymbolMutation();
  const normalized = query.trim();
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(normalized), 300);
    return () => clearTimeout(timer);
  }, [normalized]);
  const search = useAssetSearchQuery(debounced, { skip: normalized.length < 2 || debounced.length < 2 || debounced !== normalized });
  const ready = normalized.length >= 2 && debounced === normalized;
  const addSymbol = async (symbol: string) => {
    if (pending.current) return;
    pending.current = true; setFeedback('');
    try { await add(symbol).unwrap(); }
    catch (error) { setFeedback((error as ApiError)?.data?.error?.message ?? 'Unable to add this stock. Please try again.'); }
    finally { pending.current = false; }
  };
  return <div className="asset-search">
    <label htmlFor={inputId}>Search stocks or companies</label>
    <input id={inputId} type="search" maxLength={80} placeholder="Search by ticker or company name" value={query} onChange={event => { setQuery(event.target.value); setFeedback(''); }} />
    <p className="asset-search-hint">Find a US stock to add to your personal watchlist.</p>
    {feedback && <p className="error-note" role="alert">{feedback}</p>}
    {ready && search.isFetching && <p className="asset-search-state" role="status">Searching stocks and companies…</p>}
    {ready && search.isError && <div className="asset-search-state" role="alert"><p>{(search.error as ApiError)?.data?.error?.message ?? 'Stock search is temporarily unavailable.'}</p><button className="button" onClick={() => void search.refetch()}>Retry search</button></div>}
    {ready && !search.isFetching && !search.isError && search.currentData && (search.currentData.results.length ? <ul className="asset-search-results" aria-label="Stock search results">
      {search.currentData.results.map(asset => {
        const member = watchlist.entries.some(item => item.symbol === asset.symbol) || asset.inWatchlist;
        const full = watchlist.used >= watchlist.limit;
        return <li key={asset.symbol}><div className="asset-search-company"><strong>{asset.symbol}</strong><span>{asset.companyName}</span>{asset.exchange && <small>{asset.exchange}</small>}</div><button className="button" aria-label={member ? 'In watchlist' : full ? 'Limit reached' : `Add ${asset.symbol}`} disabled={member || full || adding.isLoading} onClick={() => void addSymbol(asset.symbol)}>{member ? 'In watchlist' : full ? 'Limit reached' : 'Add'}</button></li>;
      })}
    </ul> : <p className="asset-search-state" role="status">No stocks or companies found.</p>)}
  </div>;
}
