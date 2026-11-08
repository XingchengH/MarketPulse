import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeStore } from './store';
import { connectSocket } from './socket';

const { socket, handlers } = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  return {
    handlers,
    socket: { on: vi.fn((name: string, handler: (...args: unknown[]) => void) => { handlers.set(name, handler); }), io: { on: vi.fn() }, close: vi.fn(), disconnect: vi.fn(), connect: vi.fn() },
  };
});
vi.mock('socket.io-client', () => ({ io: () => socket }));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); handlers.clear(); });

describe('socket session lifecycle', () => {
  it('closes the socket and cancels renewal when its authenticated owner unmounts', () => {
    vi.useFakeTimers();
    const close = connectSocket(makeStore());
    expect(vi.getTimerCount()).toBe(1);
    close();
    expect(socket.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not reopen after logout/unmount while a session renewal is in flight', async () => {
    let finish!: (response: Response) => void;
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
    const close = connectSocket(makeStore());
    handlers.get('disconnect')?.('io server disconnect');
    close();
    finish(new Response(null, { status: 204 }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    // Flush the refresh promise and the awaiting reconnect continuation.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(socket.connect).not.toHaveBeenCalled();
    expect(socket.close).toHaveBeenCalledOnce();
  });
});
