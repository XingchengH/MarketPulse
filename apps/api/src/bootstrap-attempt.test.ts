import { describe, expect, it, vi } from 'vitest';
import { BootstrapAttempt } from './bootstrap-attempt.js';

describe('BootstrapAttempt', () => {
  it('rolls back a failed attempt so recovery registers exactly one listener', async () => {
    const listeners = new Set<() => void>();
    const emitted = vi.fn();
    const register = () => { const listener = () => emitted(); listeners.add(listener); return () => listeners.delete(listener); };

    let attempts = 0;
    const initialize = async () => {
      const attempt = new BootstrapAttempt();
      try {
        attempt.defer(register());
        attempts += 1;
        if (attempts === 1) throw new Error('fail once after provider registration');
        attempt.commit();
      } catch (error) {
        await attempt.rollback();
        throw error;
      }
    };
    await expect(initialize()).rejects.toThrow('fail once');
    await expect(initialize()).resolves.toBeUndefined();
    for (const listener of listeners) listener();

    expect(listeners.size).toBe(1);
    expect(emitted).toHaveBeenCalledOnce();
  });
});
