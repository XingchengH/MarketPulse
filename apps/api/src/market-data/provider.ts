import type { MarketEvent, ProviderState } from '@marketpulse/contracts';

export type OperationalEvent =
  | { type: 'state'; state: ProviderState }
  | { type: 'error'; message: string }
  | { type: 'reconnect' };

export interface MarketClock { isOpen: boolean; nextOpen: string; nextClose: string }

export interface MarketDataProvider {
  readonly name: 'alpaca';
  readonly state: ProviderState;
  connect(): Promise<void>;
  replaceSubscriptions(symbols: readonly string[]): void;
  disconnect(): Promise<void>;
  onEvent(listener: (event: MarketEvent) => void): () => void;
  onOperationalEvent(listener: (event: OperationalEvent) => void): () => void;
  getMarketClock(): Promise<MarketClock>;
}
