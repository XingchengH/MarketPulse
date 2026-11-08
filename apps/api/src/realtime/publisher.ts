import { watchlistLimit, type ProviderState, type RealtimeServerEvents, type SymbolsSnapshotEvent } from '@marketpulse/contracts';
import type { Server } from 'socket.io';

type Event = keyof RealtimeServerEvents;
interface SnapshotRequest {
  provider: string;
  providerState: ProviderState;
  symbols: readonly string[];
  snapshot(symbol: string): Promise<Record<string, unknown>>;
}
export class RealtimePublisher {
  private readonly last = new Map<string, number>();
  private readonly pending = new Map<string, { value: unknown; timer: NodeJS.Timeout }>();
  private readonly symbolEmissions = new Map<string, unknown>();
  private symbolImmediate?: NodeJS.Immediate;
  private readonly now: () => number;
  private snapshotRequest?: SnapshotRequest;
  private snapshotBuilding = false;
  private snapshotTimer?: NodeJS.Timeout;
  private snapshotCursor?: string;
  private lastSnapshotBuild = Number.NEGATIVE_INFINITY;
  private closed = false;
  constructor(
    private readonly server: Pick<Server, 'to'>,
    private readonly options: { intervalMs?: number; maxSymbols?: number; now?: () => number } = {},
  ) { this.now = options.now ?? Date.now; }

  private recordPublication(key: string) {
    this.last.set(key, this.now());
    // Bound tracking across watchlist churn, as well as within a single batch.
    if (this.last.size > (this.options.maxSymbols ?? 500) + 3) this.last.delete(this.last.keys().next().value!);
  }

  private publish(event: Event, value: unknown, room = 'workspace:default', replaceable = false) {
    if (this.closed) return;
    const key = `${room}/${event}`;
    const interval = this.options.intervalMs ?? 1_000;
    const elapsed = this.now() - (this.last.get(key) ?? Number.NEGATIVE_INFINITY);
    const old = this.pending.get(key);
    if (elapsed >= interval) {
      if (old) { clearTimeout(old.timer); this.pending.delete(key); }
      this.recordPublication(key);
      this.emit(room, event, value, replaceable);
      return;
    }
    if (old) { old.value = value; return; }
    if (this.pending.size >= (this.options.maxSymbols ?? 500) + 3) {
      const oldest = this.pending.keys().next().value!;
      clearTimeout(this.pending.get(oldest)!.timer);
      this.pending.delete(oldest);
    }
    const item = { value, timer: setTimeout(() => {
      this.pending.delete(key);
      this.recordPublication(key);
      this.emit(room, event, item.value, replaceable);
    }, interval - elapsed) };
    item.timer.unref?.();
    this.pending.set(key, item);
  }

  private emit(room: string, event: Event, value: unknown, replaceable: boolean) {
    if (event === 'symbols:snapshot') {
      this.symbolEmissions.set(room, value);
      if (this.symbolEmissions.size > (this.options.maxSymbols ?? 500)) this.symbolEmissions.delete(this.symbolEmissions.keys().next().value!);
      this.scheduleSymbolEmission();
      return;
    }
    const target = replaceable && 'volatile' in this.server ? (this.server as Server).volatile : this.server;
    target.to(room).emit(event, value);
  }

  private scheduleSymbolEmission() {
    if (this.closed || this.symbolImmediate || this.symbolEmissions.size === 0) return;
    this.symbolImmediate = setImmediate(() => {
      this.symbolImmediate = undefined;
      const [room, value] = this.symbolEmissions.entries().next().value!;
      this.symbolEmissions.delete(room);
      const target = 'volatile' in this.server ? (this.server as Server).volatile : this.server;
      target.to(room).emit('symbols:snapshot', value);
      // Let Engine.IO flush before sending the next room's replaceable update.
      this.scheduleSymbolEmission();
    });
    this.symbolImmediate.unref();
  }

  symbols(value: SymbolsSnapshotEvent) {
    for (const snapshot of value.slice(0, this.options.maxSymbols ?? 500)) {
      const symbol = snapshot.symbol.trim().toUpperCase();
      if (symbol) this.publish('symbols:snapshot', [{ ...snapshot, symbol }], `symbol:${symbol}`, true);
    }
  }
  providerState(state: ProviderState) { this.publish('provider:state', { state, at: new Date().toISOString() }, 'workspace:default', true); }
  alertsChanged() { this.publish('alerts:changed', { at: new Date().toISOString() }); }
  rulesChanged() { this.publish('rules:changed', { at: new Date().toISOString() }); }
  watchlistChanged(userId: string, symbols: readonly string[]) {
    if (this.closed) return;
    const normalized = [...new Set(symbols.map(symbol => symbol.trim().toUpperCase()).filter(Boolean))].slice(0, watchlistLimit);
    this.emit(`user:${userId}`, 'watchlist:changed', { symbols: normalized, used: normalized.length, limit: watchlistLimit, at: new Date().toISOString() }, false);
  }
  requestSnapshots(request: SnapshotRequest) { if (this.closed) return; this.snapshotRequest = request; this.scheduleSnapshotBuild(); }
  private scheduleSnapshotBuild() {
    if (this.closed || this.snapshotBuilding || this.snapshotTimer || !this.snapshotRequest) return;
    const wait = Math.max(0, (this.options.intervalMs ?? 1_000) - (this.now() - this.lastSnapshotBuild));
    if (wait === 0) { void this.buildSnapshots().catch(() => undefined); return; }
    this.snapshotTimer = setTimeout(() => { this.snapshotTimer = undefined; void this.buildSnapshots().catch(() => undefined); }, wait);
    this.snapshotTimer.unref?.();
  }
  private async buildSnapshots() {
    const request = this.snapshotRequest;
    if (this.closed || !request || this.snapshotBuilding) return;
    this.snapshotRequest = undefined;
    this.snapshotBuilding = true;
    this.lastSnapshotBuild = this.now();
    const symbols = this.nextSnapshotBatch(request.symbols);
    try {
      const snapshots = await Promise.all(symbols.map(symbol => request.snapshot(symbol)));
      if (this.closed) return;
      if (symbols.length > 0) this.snapshotCursor = symbols.at(-1);
      this.symbols(snapshots as SymbolsSnapshotEvent);
    } finally {
      this.snapshotBuilding = false;
      this.scheduleSnapshotBuild();
    }
  }
  private nextSnapshotBatch(input: readonly string[]): string[] {
    const symbols = [...new Set(input.map(symbol => symbol.trim().toUpperCase()).filter(Boolean))];
    const limit = Math.max(0, Math.floor(this.options.maxSymbols ?? 500));
    if (limit === 0 || symbols.length === 0) return [];
    if (symbols.length <= limit) return symbols;
    const cursorIndex = this.snapshotCursor === undefined ? -1 : symbols.indexOf(this.snapshotCursor);
    // Prefer the cursor's current position, which remains meaningful if the
    // provider reorders the union. If the cursor was removed from the sorted
    // union, choose the next lexical symbol as a stable insertion point.
    const successor = this.snapshotCursor === undefined
      ? 0
      : symbols.findIndex(symbol => symbol > this.snapshotCursor!);
    const offset = cursorIndex >= 0
      ? (cursorIndex + 1) % symbols.length
      : successor < 0 ? 0 : successor;
    const count = Math.min(limit, symbols.length);
    const batch = symbols.slice(offset, offset + count);
    if (batch.length < count) batch.push(...symbols.slice(0, count - batch.length));
    return batch;
  }
  close() {
    this.closed = true;
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    this.last.clear();
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer);
    if (this.symbolImmediate) clearImmediate(this.symbolImmediate);
    this.symbolEmissions.clear();
    this.symbolImmediate = undefined;
    this.snapshotTimer = undefined;
    this.snapshotRequest = undefined;
    this.snapshotCursor = undefined;
  }
}
