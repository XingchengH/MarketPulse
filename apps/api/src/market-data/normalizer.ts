import type { MarketEvent } from '@marketpulse/contracts';

type AlpacaMessage = Record<string, unknown>;
const iso = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
};
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

export function normalizeAlpacaMessage(message: AlpacaMessage, receivedAt = new Date()): MarketEvent | null {
  const providerTimestamp = iso(message.t);
  if (typeof message.S !== 'string' || !/^[A-Z][A-Z0-9.-]*$/.test(message.S) || !providerTimestamp) return null;
  const base = { provider: 'alpaca', feed: 'iex', symbol: message.S, providerTimestamp, receivedAt: receivedAt.toISOString() };
  if (message.T === 't' && positive(message.p) && positive(message.s)) return { ...base, type: 'trade', price: message.p, size: message.s };
  if (message.T === 'q' && positive(message.bp) && positive(message.ap)) {
    return { ...base, type: 'quote', bid: message.bp, ask: message.ap,
      ...(positive(message.bs) ? { bidSize: message.bs } : {}), ...(positive(message.as) ? { askSize: message.as } : {}) };
  }
  return null;
}
