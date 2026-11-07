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
  timeoutMs = 8_000,
}: ShutdownDependencies): (reason: string) => Promise<void> {
  let shutdownPromise: Promise<void> | undefined;

  return (reason: string) => {
    shutdownPromise ??= (async () => {
      const phaseBudget = Math.max(1, Math.floor(timeoutMs / 3));
      const stop = async (phase: string, operation: (() => Promise<void> | void) | undefined) => {
        if (!operation) return;
        try { await Promise.race([Promise.resolve().then(operation), timeoutAfter(phaseBudget, phase)]); }
        catch (error) { logger.error({ error, phase: 'http', reason }, `${phase} shutdown failed`); }
      };
      const http = stop('HTTP', () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
      await Promise.all([http, stop('Socket', socket && (() => socket.close())), stop('Provider', provider && (() => provider.disconnect())), stop('Monitoring', monitoring && (() => monitoring.stop()))]);
      server.closeAllConnections();

      await stop('Metrics', metrics && (() => metrics.flush()));

      try {
        await Promise.race([database.disconnect(), timeoutAfter(phaseBudget, 'Database')]);
      } catch (error) {
        logger.error({ error, phase: 'database', reason }, 'Database shutdown failed');
      }
    })();

    return shutdownPromise;
  };
}
