import type { MarketEvent, ProviderState } from '@marketpulse/contracts';

export type OperationalEvent =
  | { type: 'state'; state: ProviderState }
  | { type: 'error'; message: string }
  | { type: 'reconnect' };

export interface MarketClock { isOpen: boolean; nextOpen: string; nextClose: string }

export interface MarketDataProvider {
  readonly name: 'alpaca';
  state(): ProviderState;
  connect(symbols: string[]): Promise<void>;
  replaceSubscriptions(symbols: string[]): Promise<void>;
  disconnect(): Promise<void>;
  onEvent(listener: (event: MarketEvent) => void): () => void;
  onOperationalEvent(listener: (event: OperationalEvent) => void): () => void;
  getMarketClock(): Promise<MarketClock>;
}
