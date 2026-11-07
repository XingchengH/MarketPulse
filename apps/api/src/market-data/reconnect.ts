export class ReconnectBackoff {
  private attempt = 0;
  private connectedAt?: number;
  constructor(private readonly options: { random?: () => number; baseMs?: number; capMs?: number; stableAfterMs?: number } = {}) {}
  nextDelay(): number {
    const ceiling = Math.min(this.options.capMs ?? 30_000, (this.options.baseMs ?? 1_000) * 2 ** this.attempt++);
    return Math.floor((this.options.random ?? Math.random)() * ceiling);
  }
  connected(at = Date.now()): void { this.connectedAt = at; }
  disconnected(at = Date.now()): void {
    if (this.connectedAt !== undefined && at - this.connectedAt >= (this.options.stableAfterMs ?? 30_000)) this.attempt = 0;
    this.connectedAt = undefined;
  }
}
