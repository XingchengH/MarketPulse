import { describe, expect, it, vi } from 'vitest';
import { createGracefulShutdown } from './shutdown.js';

describe('graceful shutdown', () => {
  it('waits for HTTP drain before disconnecting Mongo and is idempotent', async () => {
    const order: string[] = [];
    let finishDrain!: () => void;
    const server = {
      close: (callback: (error?: Error) => void) => {
        order.push('drain-start');
        finishDrain = () => {
          order.push('drain-finish');
          callback();
        };
        return server;
      },
      closeAllConnections: vi.fn(),
    };
    const database = {
      disconnect: vi.fn(async () => {
        order.push('mongo-disconnect');
      }),
    };
    const shutdown = createGracefulShutdown({ server, database, timeoutMs: 100 });

    const first = shutdown('SIGTERM');
    const second = shutdown('SIGINT');
    await Promise.resolve();
    expect(order).toEqual(['drain-start']);
    finishDrain();
    await Promise.all([first, second]);

    expect(order).toEqual(['drain-start', 'drain-finish', 'mongo-disconnect']);
    expect(database.disconnect).toHaveBeenCalledTimes(1);
  });

  it('stops active realtime ingress during HTTP drain, then flushes metrics and closes Mongo inside one budget', async () => {
    const order: string[] = [];
    let finishDrain!: () => void;
    const server = { close: (done: (error?: Error) => void) => { order.push('http'); finishDrain = done; }, closeAllConnections: vi.fn(() => order.push('force-http')) };
    const database = { disconnect: vi.fn(async () => { order.push('mongo'); }) };
    const shutdown = createGracefulShutdown({
      server,
      database,
      socket: { close: async () => { order.push('socket'); finishDrain(); } },
      provider: { disconnect: async () => { order.push('provider'); } },
      monitoring: { stop: async () => { order.push('monitoring'); } },
      metrics: { flush: async () => { order.push('metrics'); } },
    });

    await shutdown('SIGTERM');

    expect(order.slice(0, 4)).toEqual(['http', 'socket', 'provider', 'monitoring']);
    expect(order.slice(-3)).toEqual(['force-http', 'metrics', 'mongo']);
  });

  it('bounds a stuck drain, forces connections closed, and logs failures', async () => {
    const logger = { error: vi.fn() };
    const server = {
      close: vi.fn().mockReturnThis(),
      closeAllConnections: vi.fn(),
    };
    const database = { disconnect: vi.fn().mockRejectedValue(new Error('disconnect failed')) };
    const shutdown = createGracefulShutdown({ server, database, logger, timeoutMs: 5 });

    await shutdown('SIGTERM');

    expect(server.closeAllConnections).toHaveBeenCalledOnce();
    expect(database.disconnect).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalled();
  });

  it('reserves time for final metrics and Mongo even when upgraded ingress is stuck', async () => {
    const flush = vi.fn(async () => undefined);
    const disconnect = vi.fn(async () => undefined);
    const shutdown = createGracefulShutdown({
      server: { close: vi.fn(), closeAllConnections: vi.fn() },
      socket: { close: () => new Promise<void>(() => undefined) },
      provider: { disconnect: () => new Promise<void>(() => undefined) },
      monitoring: { stop: () => undefined },
      metrics: { flush }, database: { disconnect }, timeoutMs: 30,
      logger: { error: vi.fn() },
    });
    const started = Date.now();
    await shutdown('SIGTERM');
    expect(Date.now() - started).toBeLessThan(100);
    expect(flush).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
