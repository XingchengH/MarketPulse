import type { OverviewSnapshotEvent, ProviderState, RealtimeServerEvents, SymbolsSnapshotEvent } from '@marketpulse/contracts';
import type { Server } from 'socket.io';

type Event = keyof RealtimeServerEvents;
interface SnapshotRequest {
  provider: string;
  providerState: ProviderState;
  symbols: readonly string[];
  snapshot(symbol: string): Promise<Record<string, unknown>>;
}
export class RealtimePublisher {
  private readonly last = new Map<Event, number>();
  private readonly pending = new Map<Event, { value: unknown; timer: NodeJS.Timeout }>();
  private readonly now: () => number;
  private snapshotRequest?: SnapshotRequest;
  private snapshotBuilding = false;
  private snapshotTimer?: NodeJS.Timeout;
  private lastSnapshotBuild = Number.NEGATIVE_INFINITY;
  constructor(
    private readonly server: Pick<Server, 'to'>,
    private readonly options: { intervalMs?: number; maxSymbols?: number; now?: () => number } = {},
  ) { this.now = options.now ?? Date.now; }

  private publish(event: Event, value: unknown, room = 'workspace:default', replaceable = false) {
    const interval = this.options.intervalMs ?? 1_000;
    const elapsed = this.now() - (this.last.get(event) ?? Number.NEGATIVE_INFINITY);
    if (elapsed >= interval) {
      this.last.set(event, this.now());
      this.emit(room, event, value, replaceable);
      return;
    }
    const old = this.pending.get(event);
    if (old) { old.value = value; return; }
    const item = { value, timer: setTimeout(() => {
      this.pending.delete(event);
      this.last.set(event, this.now());
      this.emit(room, event, item.value, replaceable);
    }, interval - elapsed) };
    item.timer.unref?.();
    this.pending.set(event, item);
  }

  private emit(room: string, event: Event, value: unknown, replaceable: boolean) {
    const target = replaceable && 'volatile' in this.server ? (this.server as Server).volatile : this.server;
    target.to(room).emit(event, value);
  }

  overview(value: OverviewSnapshotEvent) { this.publish('overview:snapshot', { ...value, symbols: value.symbols.slice(0, this.options.maxSymbols ?? 500) }, 'workspace:default', true); }
  symbols(value: SymbolsSnapshotEvent) { this.publish('symbols:snapshot', value.slice(0, this.options.maxSymbols ?? 500), 'workspace:default', true); }
  providerState(state: ProviderState) { this.publish('provider:state', { state, at: new Date().toISOString() }, 'workspace:default', true); }
  alertsChanged() { this.publish('alerts:changed', { at: new Date().toISOString() }); }
  rulesChanged() { this.publish('rules:changed', { at: new Date().toISOString() }); }
  requestSnapshots(request: SnapshotRequest) { this.snapshotRequest = request; this.scheduleSnapshotBuild(); }
  private scheduleSnapshotBuild() {
    if (this.snapshotBuilding || this.snapshotTimer || !this.snapshotRequest) return;
    const wait = Math.max(0, (this.options.intervalMs ?? 1_000) - (this.now() - this.lastSnapshotBuild));
    if (wait === 0) { void this.buildSnapshots().catch(() => undefined); return; }
    this.snapshotTimer = setTimeout(() => { this.snapshotTimer = undefined; void this.buildSnapshots().catch(() => undefined); }, wait);
    this.snapshotTimer.unref?.();
  }
  private async buildSnapshots() {
    const request = this.snapshotRequest;
    if (!request || this.snapshotBuilding) return;
    this.snapshotRequest = undefined;
    this.snapshotBuilding = true;
    this.lastSnapshotBuild = this.now();
    const symbols = request.symbols.slice(0, this.options.maxSymbols ?? 500);
    try {
      const snapshots = await Promise.all(symbols.map(symbol => request.snapshot(symbol)));
      this.overview({ provider: request.provider, providerState: request.providerState, symbols: [...symbols] });
      this.symbols(snapshots as SymbolsSnapshotEvent);
    } finally {
      this.snapshotBuilding = false;
      this.scheduleSnapshotBuild();
    }
  }
  close() { for (const { timer } of this.pending.values()) clearTimeout(timer); this.pending.clear(); if (this.snapshotTimer) clearTimeout(this.snapshotTimer); this.snapshotTimer = undefined; this.snapshotRequest = undefined; }
}
