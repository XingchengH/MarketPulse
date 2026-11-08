import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@marketpulse/contracts';
import { createRealtimeServer } from './socket-server.js';
import { RealtimePublisher } from './publisher.js';

const sockets: ClientSocket[] = [];
afterEach(() => { for (const socket of sockets.splice(0)) socket.close(); vi.useRealTimers(); });

async function fixture(role: Role | null, tokenRole: Role = role ?? 'viewer', webOrigin?: string, lists: Record<string, string[]> = { u1: ['AAPL'] }) {
  let currentRole = role;
  let tokenValid = true;
  const http = createServer();
  const tokens = { verifyAccessToken: vi.fn(async (value: string) => {
    const sub = value === 'good' ? 'u1' : value;
    if (!lists[sub] || !tokenValid) throw new Error('bad token');
    return { sub, role: tokenRole };
  }) };
  const symbolsForUser = vi.fn(async (id: string) => lists[id] ?? []);
  const realtime = createRealtimeServer(http, {
    tokens: tokens as never,
    findCurrentUser: vi.fn(async id => currentRole ? ({ id, role: currentRole }) : null),
    symbolsForUser,
    webOrigin,
    revalidateIntervalMs: 10,
  });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const port = (http.address() as AddressInfo).port;
  const open = (cookie?: string, origin?: string) => {
    const extraHeaders = { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) };
    const socket = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'], extraHeaders, reconnection: false });
    sockets.push(socket);
    return socket;
  };
  const close = async () => { await realtime.close(); if (http.listening) await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve())); };
  return { realtime, open, close, lists, symbolsForUser, setRole: (next: Role | null) => { currentRole = next; }, revoke: () => { tokenValid = false; } };
}

const connected = (socket: ClientSocket) => new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
const rejected = (socket: ClientSocket) => new Promise<Error>(resolve => socket.once('connect_error', resolve));

describe('realtime server', () => {
  it('isolates overlapping personal symbols, refreshes all existing sockets, and reloads rooms on reconnect', async () => {
    const app = await fixture('viewer', 'viewer', undefined, { userA: ['AAPL', 'MSFT'], userB: ['AAPL', 'TSLA'] });
    const publisher = new RealtimePublisher(app.realtime, { intervalMs: 1 });
    try {
      const a = app.open('access_token=userA'), a2 = app.open('access_token=userA'), b = app.open('access_token=userB');
      await Promise.all([connected(a), connected(a2), connected(b)]);
      const received = [a, a2, b].map(socket => {
        const symbols: string[] = [];
        socket.on('symbols:snapshot', rows => symbols.push(...rows.map((row: { symbol: string }) => row.symbol)));
        return symbols;
      });
      const overviews = vi.fn();
      a.on('overview:snapshot', overviews);
      publisher.requestSnapshots({ provider: 'alpaca', providerState: 'connected', symbols: ['AAPL', 'MSFT', 'TSLA'], snapshot: async symbol => ({ symbol }) });
      await vi.waitFor(() => expect(received).toEqual([['AAPL', 'MSFT'], ['AAPL', 'MSFT'], ['AAPL', 'TSLA']]));
      expect(overviews).not.toHaveBeenCalled();

      app.lists.userA = ['TSLA'];
      await app.realtime.refreshUserRooms('userA');
      for (const socket of app.realtime.sockets.sockets.values()) {
        if (socket.data.user.id !== 'userA') continue;
        expect(socket.rooms).toEqual(new Set([socket.id, 'workspace:default', 'user:userA', 'symbol:TSLA']));
      }
      received.forEach(values => { values.length = 0; });
      publisher.symbols([{ symbol: 'AAPL' }, { symbol: 'MSFT' }, { symbol: 'TSLA' }] as never);
      await vi.waitFor(() => expect(received).toEqual([['TSLA'], ['TSLA'], ['AAPL', 'TSLA']]));

      app.lists.userA = ['MSFT'];
      a.close();
      const reconnected = app.open('access_token=userA');
      await connected(reconnected);
      const reloaded = [...app.realtime.sockets.sockets.values()].find(socket => socket.id === reconnected.id)!;
      expect(reloaded.rooms.has('symbol:MSFT')).toBe(true);
      expect(reloaded.rooms.has('symbol:TSLA')).toBe(false);

      const changes: unknown[][] = [[], []], states: unknown[][] = [[], []];
      [a2, b].forEach((socket, index) => {
        socket.on('watchlist:changed', value => changes[index]!.push(value));
        socket.on('provider:state', value => states[index]!.push(value));
      });
      publisher.providerState('connected');
      publisher.watchlistChanged('userA', ['MSFT']);
      await vi.waitFor(() => expect(states.every(values => values.length === 1)).toBe(true));
      expect(changes).toEqual([[{ symbols: ['MSFT'], used: 1, limit: 25, at: expect.any(String) }], []]);
    } finally { publisher.close(); await app.close(); }
  });

  it('normalizes and bounds rooms and preserves current rooms if a refresh lookup fails', async () => {
    const app = await fixture('admin', 'admin', undefined, { u1: [' aapl ', 'AAPL', ...Array.from({ length: 30 }, (_, index) => `S${index}`)] });
    try {
      const socket = app.open('access_token=good');
      await connected(socket);
      const serverSocket = [...app.realtime.sockets.sockets.values()][0]!;
      expect([...serverSocket.rooms].filter(room => room.startsWith('symbol:'))).toHaveLength(25);
      expect(serverSocket.rooms.has('symbol:AAPL')).toBe(true);
      const before = new Set(serverSocket.rooms);
      app.symbolsForUser.mockRejectedValueOnce(new Error('database unavailable'));
      await expect(app.realtime.refreshUserRooms('u1')).rejects.toThrow('database unavailable');
      expect(serverSocket.rooms).toEqual(before);
      app.lists.u1 = [];
      await app.realtime.refreshUserRooms('u1');
      expect(serverSocket.rooms).toEqual(new Set([serverSocket.id, 'workspace:default', 'user:u1', 'admin:default']));
    } finally { await app.close(); }
  });

  it('refreshes authenticated handshakes without letting their older read restore removed rooms', async () => {
    const app = await fixture('viewer');
    let release!: (symbols: string[]) => void;
    let reading!: () => void;
    const started = new Promise<void>(resolve => { reading = resolve; });
    app.symbolsForUser.mockImplementationOnce(() => { reading(); return new Promise<string[]>(resolve => { release = resolve; }); });
    try {
      const socket = app.open('access_token=good');
      const connection = connected(socket);
      await started;
      app.lists.u1 = ['TSLA'];
      const refresh = app.realtime.refreshUserRooms('u1');
      release(['AAPL']);
      await Promise.all([connection, refresh]);
      const serverSocket = [...app.realtime.sockets.sockets.values()][0]!;
      expect(serverSocket.rooms.has('symbol:TSLA')).toBe(true);
      expect(serverSocket.rooms.has('symbol:AAPL')).toBe(false);
    } finally { await app.close(); }
  });

  it('closes pending handshakes when a concurrent room refresh cannot load membership', async () => {
    const app = await fixture('viewer');
    type ServerSocket = Parameters<Parameters<typeof app.realtime.use>[0]>[0];
    let release!: () => void;
    let pending!: (socket: ServerSocket) => void;
    const handshake = new Promise<ServerSocket>(resolve => { pending = resolve; });
    app.realtime.use((socket, next) => { release = next; pending(socket); });
    try {
      const socket = app.open('access_token=good');
      const serverSocket = await handshake;
      const closed = vi.spyOn(serverSocket.conn, 'close');
      app.symbolsForUser.mockRejectedValueOnce(new Error('database unavailable'));
      const refresh = app.realtime.refreshUserRooms('u1');
      await expect(refresh).rejects.toThrow('database unavailable');
      expect(closed).toHaveBeenCalled();
      release();
      await vi.waitFor(() => expect(socket.connected).toBe(false));
    } finally { await app.close(); }
  });

  it('fails closed with a generic error when personal room lookup fails during authentication', async () => {
    const app = await fixture('viewer');
    try {
      app.symbolsForUser.mockRejectedValueOnce(new Error('private database details'));
      expect((await rejected(app.open('access_token=good'))).message).toBe('Authentication required');
      expect(app.realtime.sockets.sockets.size).toBe(0);
    } finally { await app.close(); }
  });
  it('rejects anonymous and deleted users', async () => {
    const anonymous = await fixture('viewer');
    expect((await rejected(anonymous.open())).message).toBe('Authentication required');
    await anonymous.close();
    const deleted = await fixture(null);
    expect((await rejected(deleted.open('access_token=good'))).message).toBe('Authentication required');
    await deleted.close();
  });

  it.each<Role>(['viewer', 'operator', 'admin'])('uses the current %s role for server-owned rooms', async role => {
    const app = await fixture(role, 'admin');
    const socket = app.open('other=x; access_token=good');
    await connected(socket);
    const serverSocket = [...app.realtime.sockets.sockets.values()][0]!;
    expect(serverSocket.data.user).toEqual({ id: 'u1', role });
    expect(serverSocket.rooms.has('workspace:default')).toBe(true);
    expect(serverSocket.rooms.has('admin:default')).toBe(role === 'admin');
    await app.close();
  });

  it('rejects websocket upgrades from a hostile Origin', async () => {
    const app = await fixture('viewer', 'viewer', 'https://dashboard.example');
    expect((await rejected(app.open('access_token=good', 'https://evil.example'))).message).toMatch(/websocket error/i);
    const sameOriginProxy = app.open('access_token=good');
    await connected(sameOriginProxy);
    sameOriginProxy.close();
    const socket = app.open('access_token=good', 'https://dashboard.example');
    await connected(socket);
    await app.close();
  });

  it.each([null, 'viewer'] as const)('evicts admin privilege after current user changes to %s', async nextRole => {
    const app = await fixture('admin');
    const socket = app.open('access_token=good');
    await connected(socket);
    app.setRole(nextRole);
    if (nextRole === null) await new Promise<void>(resolve => socket.once('disconnect', () => resolve()));
    else await vi.waitFor(() => expect([...app.realtime.sockets.sockets.values()][0]?.rooms.has('admin:default')).toBe(false));
    await app.close();
  });

  it('disconnects a connected user when the access token is no longer valid', async () => {
    const app = await fixture('admin');
    const socket = app.open('access_token=good');
    await connected(socket);
    app.revoke();
    await new Promise<void>(resolve => socket.once('disconnect', () => resolve()));
    await app.close();
  });

  it('publishes provider state and mutation notifications', async () => {
    const app = await fixture('admin');
    const publisher = new RealtimePublisher(app.realtime);
    const socket = app.open('access_token=good');
    await connected(socket);
    const events: Record<string, unknown[]> = {};
    for (const name of ['provider:state', 'alerts:changed', 'rules:changed']) socket.on(name, value => (events[name] ??= []).push(value));
    const received = Promise.all(['provider:state', 'alerts:changed', 'rules:changed'].map(name => new Promise<void>(resolve => socket.once(name, () => resolve()))));
    publisher.providerState('connected');
    publisher.alertsChanged();
    publisher.rulesChanged();
    await received;
    expect(events['provider:state']?.at(-1)).toMatchObject({ state: 'connected' });
    expect(events['alerts:changed']).toHaveLength(1);
    expect(events['rules:changed']).toHaveLength(1);
    await app.close();
  });

  it('coalesces bursts independently per symbol, caps each batch, and cancels pending timers', async () => {
    vi.useFakeTimers();
    let now = 0;
    const emitted: Array<{ room: string; event: string; value: unknown }> = [];
    const server = { to: vi.fn((room: string) => ({ emit: (event: string, value: unknown) => { emitted.push({ room, event, value }); } })) };
    const publisher = new RealtimePublisher(server as never, { intervalMs: 1_000, maxSymbols: 2, now: () => now });
    const publishBurst = (offset: number) => {
      for (let index = 0; index < 50; index += 1) {
        publisher.symbols([{ symbol: 'AAPL', price: offset + index }, { symbol: 'MSFT', price: offset + index }, { symbol: 'NVDA' }] as never);
      }
    };

    publishBurst(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(emitted).toEqual(['AAPL', 'MSFT'].map(symbol => ({ room: `symbol:${symbol}`, event: 'symbols:snapshot', value: [{ symbol, price: 0 }] })));

    await vi.advanceTimersByTimeAsync(997);
    now = 999;
    expect(emitted).toHaveLength(2);

    now = 1_000;
    await vi.advanceTimersByTimeAsync(3);
    expect(emitted.slice(2)).toEqual(['AAPL', 'MSFT'].map(symbol => ({ room: `symbol:${symbol}`, event: 'symbols:snapshot', value: [{ symbol, price: 49 }] })));

    publishBurst(100);
    expect(emitted).toHaveLength(4);
    now = 2_000;
    await vi.advanceTimersByTimeAsync(1_002);
    expect(emitted.slice(4)).toEqual(['AAPL', 'MSFT'].map(symbol => ({ room: `symbol:${symbol}`, event: 'symbols:snapshot', value: [{ symbol, price: 149 }] })));
    publishBurst(200);
    publisher.close();
    await vi.runAllTimersAsync();
    expect(emitted).toHaveLength(6);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('gates snapshot construction, caps work, and never overlaps builds', async () => {
    vi.useFakeTimers();
    let now = 0;
    let activeBuilds = 0;
    let maxActiveBuilds = 0;
    let calls = 0;
    const releases: Array<() => void> = [];
    const snapshot = async (symbol: string) => {
      calls += 1;
      activeBuilds += 1;
      maxActiveBuilds = Math.max(maxActiveBuilds, activeBuilds);
      await new Promise<void>(resolve => releases.push(resolve));
      activeBuilds -= 1;
      return { symbol };
    };
    const target = { emit: vi.fn() };
    const server = { to: () => target, volatile: { to: () => target } };
    const publisher = new RealtimePublisher(server as never, { intervalMs: 1_000, maxSymbols: 2, now: () => now });
    const request = (index: number) => publisher.requestSnapshots({ provider: 'alpaca', providerState: 'connected', symbols: [`A${index}`, 'MSFT', 'NVDA'], snapshot });
    request(0);
    for (let index = 1; index < 100; index += 1) request(index);
    expect(calls).toBe(2);
    expect(maxActiveBuilds).toBe(2);
    releases.splice(0).forEach(resolve => resolve());
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(999);
    now = 999;
    expect(calls).toBe(2);
    now = 1_000;
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(4);
    expect(maxActiveBuilds).toBe(2);
    releases.splice(0).forEach(resolve => resolve());
    await vi.runAllTicks();
    publisher.close();
  });

  it.each([501, 1_001])('rotates bounded snapshot builds fairly through a %i-symbol union', async count => {
    vi.useFakeTimers();
    const symbols = Array.from({ length: count }, (_, index) => `S${String(index).padStart(4, '0')}`);
    const rooms: string[] = [];
    const snapshot = vi.fn(async (symbol: string) => ({ symbol }));
    const server = { volatile: { to: (room: string) => ({ emit: () => rooms.push(room) }) } };
    const publisher = new RealtimePublisher(server as never, { intervalMs: 0 });
    const batches: string[][] = [];
    const cycle = Math.ceil(count / 500);
    for (let build = 0; build < cycle + 1; build += 1) {
      snapshot.mockClear();
      rooms.length = 0;
      publisher.requestSnapshots({ provider: 'alpaca', providerState: 'connected', symbols, snapshot });
      await vi.runAllTimersAsync();
      const expected = Array.from({ length: 500 }, (_, index) => symbols[(build * 500 + index) % count]!);
      const batch = snapshot.mock.calls.map(([symbol]) => symbol);
      expect(batch).toEqual(expected);
      expect(new Set(batch).size).toBe(500);
      expect(rooms).toEqual(expected.map(symbol => `symbol:${symbol}`));
      batches.push(batch);
    }
    // Every full rotation window covers the tail as well as the first symbols.
    for (let start = 0; start <= batches.length - cycle; start += 1) {
      expect(new Set(batches.slice(start, start + cycle).flat()).size).toBe(count);
    }
    publisher.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, 1, 499, 500])('keeps the full %i-symbol union in every build when it fits the batch', async count => {
    vi.useFakeTimers();
    const symbols = Array.from({ length: count }, (_, index) => `S${index}`);
    const snapshot = vi.fn(async (symbol: string) => ({ symbol }));
    const publisher = new RealtimePublisher({ to: () => ({ emit: vi.fn() }) } as never, { intervalMs: 0 });
    for (let build = 0; build < 2; build += 1) {
      snapshot.mockClear();
      publisher.requestSnapshots({ provider: 'alpaca', providerState: 'connected', symbols, snapshot });
      await vi.runAllTimersAsync();
      expect(snapshot.mock.calls.map(([symbol]) => symbol)).toEqual(symbols);
    }
    publisher.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('wraps the snapshot cursor safely across union changes, duplicates, and empty lists', async () => {
    vi.useFakeTimers();
    const snapshot = vi.fn(async (symbol: string) => ({ symbol }));
    const publisher = new RealtimePublisher({ to: () => ({ emit: vi.fn() }) } as never, { intervalMs: 0, maxSymbols: 2 });
    const build = async (symbols: string[], expected: string[]) => {
      snapshot.mockClear();
      publisher.requestSnapshots({ provider: 'alpaca', providerState: 'connected', symbols, snapshot });
      await vi.runAllTimersAsync();
      expect(snapshot.mock.calls.map(([symbol]) => symbol)).toEqual(expected);
    };
    await build(['A', 'B', 'C', 'D', 'E'], ['A', 'B']);
    await build(['A', 'C', 'D', 'E'], ['D', 'E']);
    await build(['A', 'C', 'D', 'E'], ['A', 'C']);
    await build([], []);
    await build(['X', 'Y', 'X'], ['X', 'Y']);
    await build(['X', 'Y', 'Z'], ['X', 'Y']);
    await build(['X', 'Y', 'Z'], ['Z', 'X']);
    await build([' aapl ', 'AAPL', 'MSFT', 'TSLA'], ['MSFT', 'TSLA']);
    publisher.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('discards an overdue throttled value when a newer symbol update arrives first', async () => {
    vi.useFakeTimers();
    let now = 0;
    const emitted: unknown[] = [];
    const server = { to: () => ({ emit: (_event: string, value: unknown) => emitted.push(value) }) };
    const publisher = new RealtimePublisher(server as never, { intervalMs: 1_000, now: () => now });
    publisher.symbols([{ symbol: 'AAPL', price: 1 }] as never);
    await vi.advanceTimersByTimeAsync(0);
    publisher.symbols([{ symbol: 'AAPL', price: 2 }] as never);
    now = 1_001;
    publisher.symbols([{ symbol: 'AAPL', price: 3 }] as never);
    await vi.advanceTimersByTimeAsync(1_001);
    expect(emitted.at(-1)).toEqual([{ symbol: 'AAPL', price: 3 }]);
    publisher.close();
  });

  it('uses volatile delivery only for replaceable state', async () => {
    vi.useFakeTimers();
    const reliable = { emit: vi.fn() };
    const volatile = { emit: vi.fn() };
    const server = { to: () => reliable, volatile: { to: () => volatile } };
    const publisher = new RealtimePublisher(server as never);
    publisher.symbols([{ symbol: 'AAPL' }] as never);
    publisher.providerState('connected');
    publisher.alertsChanged();
    publisher.rulesChanged();
    publisher.watchlistChanged('u1', ['AAPL']);
    await vi.advanceTimersByTimeAsync(0);
    expect(volatile.emit.mock.calls.map(call => call[0])).toEqual(['provider:state', 'symbols:snapshot']);
    expect(reliable.emit.mock.calls.map(call => call[0])).toEqual(['alerts:changed', 'rules:changed', 'watchlist:changed']);
    publisher.close();
  });

  it('does not emit or schedule work when an in-flight build resolves after close', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const snapshot = vi.fn(async (symbol: string) => { await new Promise<void>(resolve => { release = resolve; }); return { symbol }; });
    const target = { emit: vi.fn() };
    const server = { to: () => target, volatile: { to: () => target } };
    const publisher = new RealtimePublisher(server as never);
    publisher.requestSnapshots({ provider: 'alpaca', providerState: 'connected', symbols: ['AAPL'], snapshot });
    expect(snapshot).toHaveBeenCalledOnce();
    publisher.close();
    release();
    await Promise.resolve();
    await Promise.resolve();
    publisher.requestSnapshots({ provider: 'alpaca', providerState: 'connected', symbols: ['MSFT'], snapshot });
    await vi.runAllTimersAsync();
    expect(target.emit).not.toHaveBeenCalled();
    expect(snapshot).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shuts down gracefully and disconnects clients', async () => {
    const app = await fixture('viewer');
    const socket = app.open('access_token=good');
    await connected(socket);
    const disconnected = new Promise<void>(resolve => socket.once('disconnect', () => resolve()));
    await app.realtime.close();
    await disconnected;
    await app.close();
  });
});
