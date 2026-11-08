export interface SubscriptionRepository { union(): Promise<string[]> }
export interface SubscriptionProvider { replaceSubscriptions(symbols: string[]): Promise<void> }

export class SubscriptionCoordinator {
  private applied?: string[];
  private inFlight?: Promise<void>;
  private dirty = false;
  private healthy = true;

  constructor(private readonly repository: SubscriptionRepository, private readonly provider: SubscriptionProvider) {}

  symbols(): string[] { return [...(this.applied ?? [])]; }
  isHealthy(): boolean { return this.healthy; }

  // The initial connection itself applies the first union; an immediate refresh
  // must not send the same subscription set a second time.
  initialize(connect: (symbols: string[]) => Promise<void>): Promise<void> {
    return this.enqueue(this.applied === undefined ? connect : undefined);
  }

  refresh(): Promise<void> { return this.enqueue(); }

  private enqueue(connect?: (symbols: string[]) => Promise<void>): Promise<void> {
    this.dirty = true;
    if (this.inFlight) return this.inFlight;
    const request = this.drain(connect).finally(() => { this.inFlight = undefined; });
    this.inFlight = request;
    return request;
  }

  private async drain(connect?: (symbols: string[]) => Promise<void>): Promise<void> {
    try {
      do {
        this.dirty = false;
        const next = [...new Set((await this.repository.union()).map(symbol => symbol.trim().toUpperCase()))].sort();
        const applied = this.applied;
        if (connect) {
          await connect([...next]);
          connect = undefined;
        } else if (!this.healthy || !applied || next.length !== applied.length || next.some((symbol, index) => symbol !== applied[index])) {
          // A failed call may have partially updated the provider, so explicitly
          // restore the union even if it has returned to the last applied value.
          await this.provider.replaceSubscriptions([...next]);
        }
        // Keep runtime snapshots on the last successfully applied union, even
        // when the database has committed a change that the provider rejected.
        this.applied = next;
        this.healthy = true;
      } while (this.dirty);
    } catch (error) {
      this.healthy = false;
      throw error;
    }
  }
}
