export class BootstrapAttempt {
  private cleanups: Array<() => void | Promise<void>> = [];
  private committed = false;

  defer(cleanup: () => void | Promise<void>): void {
    if (this.committed) throw new Error('Cannot register cleanup after bootstrap commit');
    this.cleanups.push(cleanup);
  }

  commit(): void {
    this.committed = true;
    this.cleanups = [];
  }

  async rollback(): Promise<void> {
    if (this.committed) return;
    for (const cleanup of this.cleanups.reverse()) {
      try { await cleanup(); } catch { /* preserve the original initialization failure */ }
    }
    this.cleanups = [];
  }
}
