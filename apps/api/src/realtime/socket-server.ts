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
}

function cookie(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

export function createRealtimeServer(httpServer: HttpServer, dependencies: RealtimeDependencies) {
  const server = new Server<Record<string, never>, RealtimeServerEvents, Record<string, never>, { user: RealtimeUser }>(httpServer, {
    cors: dependencies.webOrigin ? { origin: dependencies.webOrigin, credentials: true } : undefined,
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
      next();
    } catch {
      next(new Error('Authentication required'));
    }
  });
  server.on('connection', socket => {
    void socket.join('workspace:default');
    if (socket.data.user.role === 'admin') void socket.join('admin:default');
  });
  return server;
}
