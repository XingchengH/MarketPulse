import type { MarketEvent, ProviderState } from '@marketpulse/contracts';
import type { MarketDataProvider, OperationalEvent } from '../market-data/provider.js';

type TradeInput = Omit<Extract<MarketEvent, { type: 'trade' }>, 'provider' | 'feed' | 'type'>;

/** In-process handle used by tests; intentionally has no HTTP or Socket.IO injection route. */
export class FakeMarketDataProvider implements MarketDataProvider {
  readonly name = 'alpaca' as const;
  private status: ProviderState = 'unconfigured';
  private readonly eventListeners = new Set<(event: MarketEvent) => void>();
  private readonly operationalListeners = new Set<(event: OperationalEvent) => void>();

  constructor() {
    if (process.env.NODE_ENV !== 'test') throw new Error('Fake market-data provider is restricted to NODE_ENV=test');
  }

  readonly handle = {
    emitTrade: (trade: TradeInput) => {
      const event: MarketEvent = { ...trade, provider: 'alpaca', feed: 'iex', type: 'trade' };
      for (const listener of this.eventListeners) listener(event);
    },
  };

  state() { return this.status; }
  async connect(_symbols: string[]) { this.setState('connected'); }
  async replaceSubscriptions(_symbols: string[]) {}
  async disconnect() { this.setState('unavailable'); }
  onEvent(listener: (event: MarketEvent) => void) { this.eventListeners.add(listener); return () => this.eventListeners.delete(listener); }
  onOperationalEvent(listener: (event: OperationalEvent) => void) { this.operationalListeners.add(listener); return () => this.operationalListeners.delete(listener); }
  async getMarketClock() { return { isOpen: true, nextOpen: '', nextClose: '' }; }
  async lookupAsset(symbol: string) { return { symbol, tradable: true }; }
  private setState(state: ProviderState) { this.status = state; for (const listener of this.operationalListeners) listener({ type: 'state', state }); }
}
