interface SubscriptionRefreshRetryOptions {
  initialDelayMs?: number;
  maxDelayMs?: number;
  onSuccess?: () => void;
  onFailure?: () => void;
}

/** Retries committed watchlist changes without keeping their HTTP requests open. */
export class SubscriptionRefreshRetry {
  private readonly initialDelayMs: number;
  private readonly maxDelayMs: number;
  private timer?: ReturnType<typeof setTimeout>;
  private inFlight?: Promise<void>;
  private pending = false;
  private failures = 0;
  private closed = false;

  constructor(private readonly coordinator: { refresh(): Promise<void> }, private readonly options: SubscriptionRefreshRetryOptions = {}) {
    this.initialDelayMs = Math.max(1, options.initialDelayMs ?? 1_000);
    this.maxDelayMs = Math.max(this.initialDelayMs, options.maxDelayMs ?? 30_000);
  }

  refresh(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.pending = true;
    if (this.inFlight) return this.inFlight;
    // Mutations during backoff are included in the next authoritative union
    // read, without defeating the delay or creating additional retry timers.
    if (this.timer) return Promise.resolve();
    let resolve!: () => void;
    const request = new Promise<void>(done => { resolve = done; });
    this.inFlight = request;
    void this.drain().then(resolve);
    return request;
  }

  close(): void {
    this.closed = true;
    this.pending = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async drain(): Promise<void> {
    try {
      do {
        this.pending = false;
        try { await this.coordinator.refresh(); }
        catch {
          if (!this.closed) {
            this.scheduleRetry();
            this.notify(this.options.onFailure);
          }
          return;
        }
        if (this.closed) return;
        this.failures = 0;
        this.notify(this.options.onSuccess);
      } while (this.pending);
    } finally {
      // Clear before resolving the shared request, so a new request cannot be
      // stranded between the last pending check and promise settlement.
      this.inFlight = undefined;
    }
  }

  private scheduleRetry(): void {
    const delay = Math.min(this.maxDelayMs, this.initialDelayMs * 2 ** Math.min(this.failures++, 30));
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.refresh();
    }, delay);
    this.timer.unref?.();
  }

  private notify(callback: (() => void) | undefined): void {
    // Publication/logging failures must not stop recovery of persisted state.
    try { callback?.(); } catch { /* the subscription retry still owns recovery */ }
  }
}
