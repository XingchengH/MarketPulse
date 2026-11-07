import { describe, expect, it, vi } from 'vitest';
import { connectDatabase } from './db.js';

describe('database readiness', () => {
  it('reflects connection loss and recovery using a bounded live probe', async () => {
    const command = vi
      .fn()
      .mockResolvedValueOnce({ ok: 1 })
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce({ ok: 1 });
    const client = {
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      db: () => ({ command }),
    };
    const database = connectDatabase('mongodb://unused', { client, pingTimeoutMs: 25 });

    await database.connect();
    expect(await database.isReady()).toBe(false);
    expect(await database.isReady()).toBe(true);
    expect(command).toHaveBeenLastCalledWith(
      { ping: 1 },
      expect.objectContaining({ maxTimeMS: 25, signal: expect.any(AbortSignal) }),
    );
  });
});
