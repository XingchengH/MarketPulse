import type { OverviewSnapshotEvent, ProviderState, RealtimeServerEvents, SymbolsSnapshotEvent } from '@marketpulse/contracts';
import type { Server } from 'socket.io';

type Event = keyof RealtimeServerEvents;
export class RealtimePublisher {
  private readonly last = new Map<Event, number>();
  private readonly pending = new Map<Event, { value: unknown; timer: NodeJS.Timeout }>();
  private readonly now: () => number;
  constructor(
    private readonly server: Pick<Server, 'to'>,
    private readonly options: { intervalMs?: number; maxSymbols?: number; now?: () => number } = {},
  ) { this.now = options.now ?? Date.now; }

  private publish(event: Event, value: unknown, room = 'workspace:default') {
    const interval = this.options.intervalMs ?? 1_000;
    const elapsed = this.now() - (this.last.get(event) ?? Number.NEGATIVE_INFINITY);
    if (elapsed >= interval) {
      this.last.set(event, this.now());
      this.server.to(room).emit(event, value);
      return;
    }
    const old = this.pending.get(event);
    if (old) { old.value = value; return; }
    const item = { value, timer: setTimeout(() => {
      this.pending.delete(event);
      this.last.set(event, this.now());
      this.server.to(room).emit(event, item.value);
    }, interval - elapsed) };
    item.timer.unref?.();
    this.pending.set(event, item);
  }

  overview(value: OverviewSnapshotEvent) { this.publish('overview:snapshot', { ...value, symbols: value.symbols.slice(0, this.options.maxSymbols ?? 500) }); }
  symbols(value: SymbolsSnapshotEvent) { this.publish('symbols:snapshot', value.slice(0, this.options.maxSymbols ?? 500)); }
  providerState(state: ProviderState) { this.publish('provider:state', { state, at: new Date().toISOString() }); }
  alertsChanged() { this.publish('alerts:changed', { at: new Date().toISOString() }); }
  rulesChanged() { this.publish('rules:changed', { at: new Date().toISOString() }); }
  close() { for (const { timer } of this.pending.values()) clearTimeout(timer); this.pending.clear(); }
}
