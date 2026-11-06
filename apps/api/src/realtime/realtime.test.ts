import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@marketpulse/contracts';
import { createRealtimeServer } from './socket-server.js';
import { RealtimePublisher } from './publisher.js';

const sockets: ClientSocket[] = [];
afterEach(() => { for (const socket of sockets.splice(0)) socket.close(); vi.useRealTimers(); });

async function fixture(role: Role | null, tokenRole: Role = role ?? 'viewer', webOrigin?: string) {
  let currentRole = role;
  let tokenValid = true;
  const http = createServer();
  const tokens = { verifyAccessToken: vi.fn(async (value: string) => {
    if (value !== 'good' || !tokenValid) throw new Error('bad token');
    return { sub: 'u1', role: tokenRole };
  }) };
  const realtime = createRealtimeServer(http, {
    tokens: tokens as never,
    findCurrentUser: vi.fn(async () => currentRole ? ({ id: 'u1', role: currentRole }) : null),
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
  return { realtime, open, close, setRole: (next: Role | null) => { currentRole = next; }, revoke: () => { tokenValid = false; } };
}

const connected = (socket: ClientSocket) => new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
const rejected = (socket: ClientSocket) => new Promise<Error>(resolve => socket.once('connect_error', resolve));

describe('realtime server', () => {
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

  it('coalesces provider bursts to one bounded overview and symbols snapshot per interval', async () => {
    vi.useFakeTimers();
    let now = 0;
    const emitted: Array<{ event: string; value: unknown }> = [];
    const target = { emit: (event: string, value: unknown) => { emitted.push({ event, value }); } };
    const server = { to: vi.fn(() => target) };
    const publisher = new RealtimePublisher(server as never, { intervalMs: 1_000, maxSymbols: 2, now: () => now });
    const publishBurst = (offset: number) => {
      for (let index = 0; index < 50; index += 1) {
        publisher.overview({ provider: 'alpaca', providerState: 'connected', symbols: [`A${offset + index}`, 'MSFT', 'NVDA'] });
        publisher.symbols([{ symbol: `A${offset + index}` }, { symbol: 'MSFT' }, { symbol: 'NVDA' }] as never);
      }
    };

    publishBurst(0);
    expect(emitted.filter(value => value.event === 'overview:snapshot')).toHaveLength(1);
    expect(emitted.filter(value => value.event === 'symbols:snapshot')).toHaveLength(1);
    expect((emitted.find(value => value.event === 'overview:snapshot')?.value as { symbols: string[] }).symbols).toHaveLength(2);
    expect((emitted.find(value => value.event === 'symbols:snapshot')?.value as unknown[])).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(999);
    now = 999;
    expect(emitted.filter(value => value.event === 'overview:snapshot')).toHaveLength(1);
    expect(emitted.filter(value => value.event === 'symbols:snapshot')).toHaveLength(1);

    now = 1_000;
    await vi.advanceTimersByTimeAsync(1);
    expect(emitted.filter(value => value.event === 'overview:snapshot')).toHaveLength(2);
    expect(emitted.filter(value => value.event === 'symbols:snapshot')).toHaveLength(2);

    publishBurst(100);
    expect(emitted.filter(value => value.event === 'overview:snapshot')).toHaveLength(2);
    expect(emitted.filter(value => value.event === 'symbols:snapshot')).toHaveLength(2);
    now = 2_000;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(emitted.filter(value => value.event === 'overview:snapshot')).toHaveLength(3);
    expect(emitted.filter(value => value.event === 'symbols:snapshot')).toHaveLength(3);
    publisher.close();
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

  it('uses volatile delivery only for replaceable state', () => {
    const reliable = { emit: vi.fn() };
    const volatile = { emit: vi.fn() };
    const server = { to: () => reliable, volatile: { to: () => volatile } };
    const publisher = new RealtimePublisher(server as never);
    publisher.overview({ provider: 'alpaca', providerState: 'connected', symbols: [] });
    publisher.symbols([]);
    publisher.providerState('connected');
    publisher.alertsChanged();
    publisher.rulesChanged();
    expect(volatile.emit.mock.calls.map(call => call[0])).toEqual(['overview:snapshot', 'symbols:snapshot', 'provider:state']);
    expect(reliable.emit.mock.calls.map(call => call[0])).toEqual(['alerts:changed', 'rules:changed']);
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
