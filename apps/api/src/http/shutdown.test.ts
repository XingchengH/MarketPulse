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
    expect(order).toEqual(['drain-start']);
    finishDrain();
    await Promise.all([first, second]);

    expect(order).toEqual(['drain-start', 'drain-finish', 'mongo-disconnect']);
    expect(database.disconnect).toHaveBeenCalledTimes(1);
  });

  it('stops ingress before monitoring, flushes metrics, and finally closes Mongo', async () => {
    const order: string[] = [];
    const server = { close: (done: (error?: Error) => void) => { order.push('http'); done(); }, closeAllConnections: vi.fn() };
    const database = { disconnect: vi.fn(async () => { order.push('mongo'); }) };
    const shutdown = createGracefulShutdown({
      server,
      database,
      socket: { close: async () => { order.push('socket'); } },
      provider: { disconnect: async () => { order.push('provider'); } },
      monitoring: { stop: async () => { order.push('monitoring'); } },
      metrics: { flush: async () => { order.push('metrics'); } },
    });

    await shutdown('SIGTERM');

    expect(order).toEqual(['http', 'socket', 'provider', 'monitoring', 'metrics', 'mongo']);
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
});
