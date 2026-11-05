import type { MarketEvent } from '@marketpulse/contracts';
import type { MarketClockCache } from './market-clock.js';

class Ring {
  private values: number[] = [];
  constructor(private readonly capacity: number) {}
  push(value: number) { if (this.values.length === this.capacity) this.values.shift(); this.values.push(value); }
  get length() { return this.values.length; }
  latest() { return this.values.at(-1) ?? 0; }
  p95() { const values = [...this.values].sort((a, b) => a - b); return values[Math.max(0, Math.ceil(values.length * .95) - 1)] ?? 0; }
}
interface State { latestTrade?: Extract<MarketEvent, { type: 'trade' }>; latestQuote?: Extract<MarketEvent, { type: 'quote' }>; messages: number[]; latency: Ring; lastEventAt?: number; providerErrors: number; reconnects: number }

export class MarketDataAggregator {
  private readonly states = new Map<string, State>();
  constructor(private readonly options: { latencyCapacity?: number; now?: () => Date; marketClock?: Pick<MarketClockCache, 'get'> } = {}) {}
  private state(symbol: string): State { let value = this.states.get(symbol); if (!value) { value = { messages: [], latency: new Ring(this.options.latencyCapacity ?? 512), providerErrors: 0, reconnects: 0 }; this.states.set(symbol, value); } return value; }
  ingest(event: MarketEvent): void {
    const state = this.state(event.symbol); const received = Date.parse(event.receivedAt);
    if (event.type === 'trade') state.latestTrade = event; else state.latestQuote = event;
    state.messages.push(received); state.lastEventAt = received; state.latency.push(Math.max(0, received - Date.parse(event.providerTimestamp)));
  }
  recordProviderError(symbols: readonly string[]) { for (const symbol of symbols) this.state(symbol).providerErrors += 1; }
  recordReconnect(symbols: readonly string[]) { for (const symbol of symbols) this.state(symbol).reconnects += 1; }
  latencySampleCount(symbol: string) { return this.state(symbol).latency.length; }
  snapshot(symbol: string) {
    const state = this.state(symbol); const now = (this.options.now ?? (() => new Date()))().valueOf();
    state.messages = state.messages.filter(time => time > now - 1_000 && time <= now);
    return { symbol, latestTrade: state.latestTrade && { price: state.latestTrade.price, size: state.latestTrade.size, providerTimestamp: state.latestTrade.providerTimestamp }, latestQuote: state.latestQuote && { bid: state.latestQuote.bid, ask: state.latestQuote.ask, bidSize: state.latestQuote.bidSize, askSize: state.latestQuote.askSize, providerTimestamp: state.latestQuote.providerTimestamp }, spread: state.latestQuote ? state.latestQuote.ask - state.latestQuote.bid : undefined, receivedMessagesPerSecond: state.messages.length, lastEventAt: state.lastEventAt ? new Date(state.lastEventAt).toISOString() : null, observedLatency: { latest: state.latency.latest(), p95: state.latency.p95() }, providerErrors: state.providerErrors, reconnects: state.reconnects, staleDurationMs: state.lastEventAt ? Math.max(0, now - state.lastEventAt) : 0 };
  }
  async snapshotWithMarketState(symbol: string) { const value = this.snapshot(symbol); const clock = await this.options.marketClock?.get(); return { ...value, staleDurationMs: clock?.isOpen ? value.staleDurationMs : 0, marketClock: clock }; }
  symbols() { return [...this.states.keys()].sort(); }
}
