import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@marketpulse/contracts';
import { createRealtimeServer } from './socket-server.js';
import { RealtimePublisher } from './publisher.js';

const sockets: ClientSocket[] = [];
afterEach(() => { for (const socket of sockets.splice(0)) socket.close(); vi.useRealTimers(); });

async function fixture(role: Role | null, tokenRole: Role = role ?? 'viewer') {
  const http = createServer();
  const tokens = { verifyAccessToken: vi.fn(async (value: string) => {
    if (value !== 'good') throw new Error('bad token');
    return { sub: 'u1', role: tokenRole };
  }) };
  const realtime = createRealtimeServer(http, {
    tokens: tokens as never,
    findCurrentUser: vi.fn(async () => role ? ({ id: 'u1', role }) : null),
  });
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
  const port = (http.address() as AddressInfo).port;
  const open = (cookie?: string) => {
    const socket = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'], extraHeaders: cookie ? { cookie } : undefined, reconnection: false });
    sockets.push(socket);
    return socket;
  };
  const close = async () => { await realtime.close(); if (http.listening) await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve())); };
  return { realtime, open, close };
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

    now = 999;
    await vi.advanceTimersByTimeAsync(999);
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
