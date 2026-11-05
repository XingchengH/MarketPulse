import type { Role } from '@marketpulse/contracts';
import type { RequestHandler } from 'express';
import { readCookie, cookieNames } from './cookies.js';
import { hasRole } from './rbac.js';
import type { TokenService } from './tokens.js';

export const requireUser = (tokens: TokenService): RequestHandler => async (request, response, next) => {
  const value = readCookie(request, cookieNames.access);
  if (!value) return response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
  try {
    response.locals.user = await tokens.verifyAccessToken(value);
    next();
  } catch {
    response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
  }
};

export const requireRole = (role: Role): RequestHandler => (_request, response, next) => {
  const user = response.locals.user as { role?: Role } | undefined;
  if (!user?.role) return response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
  if (!hasRole(user.role, role)) return response.status(403).json({ error: { code: 'FORBIDDEN', message: 'Insufficient role' } });
  next();
};
