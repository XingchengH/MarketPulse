import type { MarketEvent, ProviderState } from '@marketpulse/contracts';
import { normalizeAlpacaMessage } from './normalizer.js';
import { MarketClockCache } from './market-clock.js';
import type { MarketClock, MarketDataProvider, OperationalEvent } from './provider.js';
import { ReconnectBackoff } from './reconnect.js';

interface SocketLike {
  send(data: string): void; close(): void;
  addEventListener(type: 'open' | 'close' | 'message' | 'error', listener: (event: { data?: unknown }) => void): void;
}
export interface AlpacaProviderOptions {
  apiKey: string; apiSecret: string;
  socketFactory?: (url: string) => SocketLike;
  fetch?: typeof fetch;
  setTimeout?: (callback: () => void, delay: number) => unknown;
}

export class AlpacaProvider implements MarketDataProvider {
  readonly name = 'alpaca' as const;
  private providerState: ProviderState = 'unconfigured';
  private socket?: SocketLike; private desiredSymbols: string[] = []; private activeSymbols: string[] = []; private stopped = false;
  private readonly events = new Set<(event: MarketEvent) => void>(); private readonly operational = new Set<(event: OperationalEvent) => void>();
  private readonly backoff = new ReconnectBackoff();
  private readonly clock: MarketClockCache;
  constructor(private readonly options: AlpacaProviderOptions) {
    this.clock = new MarketClockCache(async () => {
      const response = await (options.fetch ?? fetch)('https://api.alpaca.markets/v2/clock', { headers: { 'APCA-API-KEY-ID': options.apiKey, 'APCA-API-SECRET-KEY': options.apiSecret } });
      if (!response.ok) throw new Error(`Alpaca clock request failed (${response.status})`);
      const body = await response.json() as { is_open: boolean; next_open: string; next_close: string };
      return { isOpen: body.is_open, nextOpen: body.next_open, nextClose: body.next_close };
    });
  }
  state(): ProviderState { return this.providerState; }
  private transition(state: ProviderState) { this.providerState = state; for (const listener of this.operational) listener({ type: 'state', state }); }
  async connect(symbols: string[]): Promise<void> {
    this.desiredSymbols = [...new Set(symbols.map(value => value.toUpperCase()))];
    if (!this.options.apiKey || !this.options.apiSecret) { this.transition('unconfigured'); return; }
    this.stopped = false; this.transition(this.socket ? 'reconnecting' : 'connecting');
    const socketFactory = this.options.socketFactory ?? ((url: string) => new WebSocket(url) as unknown as SocketLike);
    const socket = socketFactory('wss://stream.data.alpaca.markets/v2/iex'); this.socket = socket;
    socket.addEventListener('open', () => socket.send(JSON.stringify({ action: 'auth', key: this.options.apiKey, secret: this.options.apiSecret })));
    socket.addEventListener('message', event => this.handleMessage(event.data));
    socket.addEventListener('error', () => { for (const listener of this.operational) listener({ type: 'error', message: 'Alpaca stream error' }); });
    socket.addEventListener('close', () => { this.backoff.disconnected(); this.socket = undefined; if (!this.stopped) this.scheduleReconnect(); });
  }
  private handleMessage(raw: unknown) {
    try {
      const batch = JSON.parse(typeof raw === 'string' ? raw : String(raw)) as Array<Record<string, unknown>>;
      for (const message of batch) {
        if (message.T === 'success' && message.msg === 'authenticated') { this.transition('connected'); this.backoff.connected(); this.sendSubscriptions(); continue; }
        if (message.T === 'success' && message.msg === 'connected') { this.transition('connecting'); continue; }
        if (message.T === 'subscription') {
          const trades = Array.isArray(message.trades) ? message.trades.filter((value): value is string => typeof value === 'string') : [];
          const quotes = Array.isArray(message.quotes) ? message.quotes.filter((value): value is string => typeof value === 'string') : [];
          this.activeSymbols = [...new Set([...trades, ...quotes])];
          this.transition('connected');
          continue;
        }
        if (message.T === 'error') { const code = Number(message.code); this.transition(code === 429 ? 'rate_limited' : 'unavailable'); for (const listener of this.operational) listener({ type: 'error', message: `Alpaca stream rejected request (${code || 'unknown'})` }); continue; }
        const event = normalizeAlpacaMessage(message); if (event) for (const listener of this.events) listener(event);
      }
    } catch { for (const listener of this.operational) listener({ type: 'error', message: 'Invalid Alpaca stream message' }); }
  }
  private scheduleReconnect() { this.transition('reconnecting'); for (const listener of this.operational) listener({ type: 'reconnect' }); (this.options.setTimeout ?? setTimeout)(() => void this.connect(this.desiredSymbols), this.backoff.nextDelay()); }
  private sendSubscriptions() { if (this.socket) { this.socket.send(JSON.stringify({ action: 'subscribe', trades: this.desiredSymbols, quotes: this.desiredSymbols })); this.activeSymbols = [...this.desiredSymbols]; } }
  async replaceSubscriptions(symbols: string[]): Promise<void> {
    const previous = this.activeSymbols; this.desiredSymbols = [...new Set(symbols.map(value => value.toUpperCase()))];
    if (this.providerState === 'connected' && this.socket) {
      if (previous.length) this.socket.send(JSON.stringify({ action: 'unsubscribe', trades: previous, quotes: previous }));
      this.sendSubscriptions();
    }
  }
  async disconnect(): Promise<void> { this.stopped = true; this.socket?.close(); this.socket = undefined; this.transition(this.options.apiKey && this.options.apiSecret ? 'unavailable' : 'unconfigured'); }
  onEvent(listener: (event: MarketEvent) => void) { this.events.add(listener); return () => this.events.delete(listener); }
  onOperationalEvent(listener: (event: OperationalEvent) => void) { this.operational.add(listener); return () => this.operational.delete(listener); }
  async getMarketClock(): Promise<MarketClock> { const clock = await this.clock.get(); if (!clock.isOpen) this.transition('market_closed'); else if (this.providerState === 'market_closed') this.transition('connected'); return clock; }
}

export class FakeMarketDataProvider implements MarketDataProvider {
  readonly name = 'alpaca' as const; private providerState: ProviderState = 'connected';
  private listeners = new Set<(event: MarketEvent) => void>();
  constructor(nodeEnv = process.env.NODE_ENV) { if (nodeEnv !== 'test') throw new Error('Fake market data provider is test-only'); }
  state() { return this.providerState; }
  async connect(_symbols: string[]) {} async replaceSubscriptions(_symbols: string[]) {} async disconnect() {}
  onEvent(listener: (event: MarketEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  onOperationalEvent(_listener: (event: OperationalEvent) => void) { return () => undefined; }
  async getMarketClock() { return { isOpen: true, nextOpen: '', nextClose: '' }; }
  emit(event: MarketEvent) { for (const listener of this.listeners) listener(event); }
}
