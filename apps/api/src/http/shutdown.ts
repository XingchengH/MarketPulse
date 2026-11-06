interface DrainableServer {
  close(callback: (error?: Error) => void): unknown;
  closeAllConnections(): void;
}

interface ShutdownDatabase {
  disconnect(): Promise<void>;
}

interface ShutdownLogger {
  error(details: { error: unknown; phase: 'http' | 'database'; reason: string }, message: string): void;
}

interface ShutdownDependencies {
  server: DrainableServer;
  database: ShutdownDatabase;
  socket?: { close(): Promise<void> | void };
  provider?: { disconnect(): Promise<void> };
  monitoring?: { stop(): Promise<void> | void };
  metrics?: { flush(): Promise<void> };
  logger?: ShutdownLogger;
  timeoutMs?: number;
}

function timeoutAfter(milliseconds: number, phase: string): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`${phase} shutdown timed out`)), milliseconds);
    timer.unref();
  });
}

export function createGracefulShutdown({
  server,
  database,
  socket,
  provider,
  monitoring,
  metrics,
  logger = console,
  timeoutMs = 10_000,
}: ShutdownDependencies): (reason: string) => Promise<void> {
  let shutdownPromise: Promise<void> | undefined;

  return (reason: string) => {
    shutdownPromise ??= (async () => {
      try {
        await Promise.race([
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          }),
          timeoutAfter(timeoutMs, 'HTTP'),
        ]);
      } catch (error) {
        logger.error({ error, phase: 'http', reason }, 'HTTP shutdown failed');
        server.closeAllConnections();
      }

      for (const [phase, operation] of [
        ['Socket', () => socket?.close()],
        ['Provider', () => provider?.disconnect()],
        ['Monitoring', () => monitoring?.stop()],
        ['Metrics', () => metrics?.flush()],
      ] as const) {
        const pending = operation();
        if (!pending) continue;
        try { await Promise.race([Promise.resolve(pending), timeoutAfter(timeoutMs, phase)]); }
        catch (error) { logger.error({ error, phase: 'http', reason }, `${phase} shutdown failed`); }
      }

      try {
        await Promise.race([database.disconnect(), timeoutAfter(timeoutMs, 'Database')]);
      } catch (error) {
        logger.error({ error, phase: 'database', reason }, 'Database shutdown failed');
      }
    })();

    return shutdownPromise;
  };
}
