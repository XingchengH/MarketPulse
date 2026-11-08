import type { Server as HttpServer } from 'node:http';
import { watchlistLimit, type Role, type RealtimeServerEvents } from '@marketpulse/contracts';
import { Server } from 'socket.io';
import { cookieNames } from '../auth/cookies.js';
import type { TokenService } from '../auth/tokens.js';

export interface RealtimeUser { id: string; role: Role }
export interface RealtimeDependencies {
  tokens: Pick<TokenService, 'verifyAccessToken'>;
  findCurrentUser(id: string): Promise<RealtimeUser | null>;
  symbolsForUser(userId: string): Promise<string[]>;
  webOrigin?: string;
  revalidateIntervalMs?: number;
}

function cookie(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

export function createRealtimeServer(httpServer: HttpServer, dependencies: RealtimeDependencies) {
  const server = new Server<Record<string, never>, RealtimeServerEvents, Record<string, never>, { user: RealtimeUser; accessToken: string }>(httpServer, {
    cors: dependencies.webOrigin ? { origin: dependencies.webOrigin, credentials: true } : undefined,
    allowRequest: dependencies.webOrigin ? (request, callback) => callback(null, !request.headers.origin || request.headers.origin === dependencies.webOrigin) : undefined,
    serveClient: false,
  });
  const symbolRooms = async (userId: string) => new Set((await dependencies.symbolsForUser(userId))
    .map(symbol => symbol.trim().toUpperCase()).filter(Boolean)
    .filter((symbol, index, symbols) => symbols.indexOf(symbol) === index)
    .slice(0, watchlistLimit).map(symbol => `symbol:${symbol}`));
  // Serialize refreshes for a user so an older database read cannot overwrite a
  // newer mutation's memberships. A failed lookup leaves existing rooms intact.
  const refreshing = new Map<string, Promise<void>>();
  type PersonalSocket = Parameters<Parameters<typeof server.use>[0]>[0];
  const personalSockets = new Map<string, Set<PersonalSocket>>();
  const updateRooms = (userId: string, update: () => Promise<void>): Promise<void> => {
    const operation = (refreshing.get(userId) ?? Promise.resolve()).catch(() => undefined).then(update);
    refreshing.set(userId, operation);
    void operation.finally(() => { if (refreshing.get(userId) === operation) refreshing.delete(userId); }).catch(() => undefined);
    return operation;
  };
  const refreshUserRooms = (userId: string): Promise<void> => updateRooms(userId, async () => {
    try {
      const desired = await symbolRooms(userId);
      for (const socket of personalSockets.get(userId) ?? []) {
        for (const room of socket.rooms) if (room.startsWith('symbol:') && !desired.has(room)) await socket.leave(room);
        await socket.join([...desired]);
      }
    } catch (error) {
      // The caller can evict connected sockets through the user room. Pending
      // handshakes are not in that namespace yet, so close them here as well.
      for (const socket of personalSockets.get(userId) ?? []) if (!socket.connected) socket.conn.close();
      throw error;
    }
  });
  server.use(async (socket, next) => {
    let cleanup: () => void = () => undefined;
    try {
      const access = cookie(socket.handshake.headers.cookie, cookieNames.access);
      if (!access) throw new Error('missing token');
      const claims = await dependencies.tokens.verifyAccessToken(access);
      const current = await dependencies.findCurrentUser(claims.sub);
      if (!current || current.id !== claims.sub) throw new Error('missing user');
      socket.data.user = { id: current.id, role: current.role };
      socket.data.accessToken = access;
      const userSockets = personalSockets.get(current.id) ?? new Set();
      personalSockets.set(current.id, userSockets);
      userSockets.add(socket);
      cleanup = () => { userSockets.delete(socket); if (userSockets.size === 0 && personalSockets.get(current.id) === userSockets) personalSockets.delete(current.id); };
      socket.conn.once('close', cleanup);
      // Include authenticated handshakes in refreshes, closing the race between
      // reading membership and Socket.IO adding a connected socket to its map.
      await updateRooms(current.id, async () => {
        const rooms = await symbolRooms(current.id);
        await socket.join(['workspace:default', `user:${current.id}`, ...rooms]);
        if (current.role === 'admin') await socket.join('admin:default');
      });
      next();
    } catch {
      cleanup();
      next(new Error('Authentication required'));
    }
  });
  const revalidate = setInterval(() => {
    for (const socket of server.sockets.sockets.values()) void (async () => {
      try {
        const claims = await dependencies.tokens.verifyAccessToken(socket.data.accessToken);
        const current = await dependencies.findCurrentUser(claims.sub);
        if (!current || current.id !== claims.sub) return socket.disconnect(true);
        socket.data.user = { id: current.id, role: current.role };
        if (current.role === 'admin') await socket.join('admin:default');
        else await socket.leave('admin:default');
      } catch { socket.disconnect(true); }
    })();
  }, dependencies.revalidateIntervalMs ?? 30_000);
  revalidate.unref();
  server.engine.on('close', () => clearInterval(revalidate));
  return Object.assign(server, { refreshUserRooms });
}
