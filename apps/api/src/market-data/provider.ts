import type { MarketEvent, ProviderState } from '@marketpulse/contracts';

export type OperationalEvent =
  | { type: 'state'; state: ProviderState }
  | { type: 'error'; message: string }
  | { type: 'reconnect' };

export interface MarketClock {
  isOpen: boolean;
  nextOpen: string;
  nextClose: string;
  status?: 'current' | 'degraded';
  fetchedAt?: string;
  staleAgeMs?: number;
}

export interface ProviderAsset {
  symbol: string;
  name: string;
  exchange?: string;
  assetClass: 'us_equity';
  status: 'active' | 'inactive';
  tradable: boolean;
}

export interface MarketDataProvider {
  readonly name: 'alpaca';
  state(): ProviderState;
  connect(symbols: string[]): Promise<void>;
  replaceSubscriptions(symbols: string[]): Promise<void>;
  disconnect(): Promise<void>;
  onEvent(listener: (event: MarketEvent) => void): () => void;
  onOperationalEvent(listener: (event: OperationalEvent) => void): () => void;
  getMarketClock(): Promise<MarketClock>;
  lookupAsset(symbol: string): Promise<{ symbol: string; tradable: boolean } | null>;
  listAssets(): Promise<ProviderAsset[]>;
}
