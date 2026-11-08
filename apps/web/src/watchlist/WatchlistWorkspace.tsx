import { useWatchlistQuery } from '../api';
import { FeedsPage } from '../dashboard/FeedsPage';
import { AssetSearch } from './AssetSearch';

export function WatchlistWorkspace() {
  const watchlist = useWatchlistQuery();
  return <>
    <div className="page-heading"><div><p className="eyebrow">Live application data</p><h1>Live feeds</h1><p>Inspect per-symbol delivery health and observed metrics.</p></div></div>
    <section className="panel watchlist-workspace" aria-labelledby="personal-watchlist-title">
      <div className="panel-heading"><div><h2 id="personal-watchlist-title">Your watchlist</h2><p>Choose the stocks you want to monitor.</p></div>{watchlist.data && <span className="watchlist-counter" role="status" aria-label={`${watchlist.data.watchlist.used} of ${watchlist.data.watchlist.limit} watchlist slots used`}>{watchlist.data.watchlist.used}/{watchlist.data.watchlist.limit}</span>}</div>
      {watchlist.isLoading && <p className="loading-state">Loading watchlist…</p>}
      {watchlist.isError && <div className="error-state"><h3>Watchlist is unavailable</h3><button className="button" onClick={() => void watchlist.refetch()}>Retry watchlist</button></div>}
      {watchlist.data && <AssetSearch watchlist={watchlist.data.watchlist} />}
    </section>
    {watchlist.data && <FeedsPage />}
  </>;
}
