import type { Server as HttpServer } from 'node:http';
import type { Role, RealtimeServerEvents } from '@marketpulse/contracts';
import { Server } from 'socket.io';
import { cookieNames } from '../auth/cookies.js';
import type { TokenService } from '../auth/tokens.js';

export interface RealtimeUser { id: string; role: Role }
export interface RealtimeDependencies {
  tokens: Pick<TokenService, 'verifyAccessToken'>;
  findCurrentUser(id: string): Promise<RealtimeUser | null>;
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
  server.use(async (socket, next) => {
    try {
      const access = cookie(socket.handshake.headers.cookie, cookieNames.access);
      if (!access) throw new Error('missing token');
      const claims = await dependencies.tokens.verifyAccessToken(access);
      const current = await dependencies.findCurrentUser(claims.sub);
      if (!current || current.id !== claims.sub) throw new Error('missing user');
      socket.data.user = { id: current.id, role: current.role };
      socket.data.accessToken = access;
      next();
    } catch {
      next(new Error('Authentication required'));
    }
  });
  server.on('connection', socket => {
    void socket.join('workspace:default');
    if (socket.data.user.role === 'admin') void socket.join('admin:default');
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
  return server;
}
