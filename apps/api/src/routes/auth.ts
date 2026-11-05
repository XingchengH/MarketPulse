import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import type { Role } from '@marketpulse/contracts';
import type { GoogleIdentityProvider, GoogleProfile } from '../auth/google-provider.js';
import { clearAuthCookies, clearStateCookie, cookieNames, readCookie, setAuthCookies, setStateCookie } from '../auth/cookies.js';
import { requireUser } from '../auth/middleware.js';
import type { TokenService } from '../auth/tokens.js';

export interface PublicUser { id: string; email: string; name: string; picture?: string; role: Role }
export interface RefreshRecord { tokenHash: string; userId: string; familyId: string; expiresAt: Date; revokedAt?: Date; replacedByHash?: string }
export interface AuthRepository {
  upsertGoogleUser(profile: GoogleProfile): Promise<PublicUser>;
  findUserById(id: string): Promise<PublicUser | null>;
  saveRefresh(record: RefreshRecord): Promise<void>;
  findRefresh(tokenHash: string): Promise<RefreshRecord | null>;
  rotateRefresh(currentHash: string, replacement: RefreshRecord): Promise<boolean>;
  revokeFamily(familyId: string): Promise<void>;
}

interface Dependencies { provider: GoogleIdentityProvider; repository: AuthRepository; tokens: TokenService; nodeEnv: string; webOrigin: string }
const refreshExpiry = () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const safeEqual = (left: string, right: string) => {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

export function createAuthRouter({ provider, repository, tokens, nodeEnv }: Dependencies): Router {
  const router = Router();
  const production = nodeEnv === 'production';

  router.get('/google', (_request, response) => {
    const state = randomBytes(32).toString('base64url');
    setStateCookie(response, state, production);
    response.redirect(provider.authorizationUrl(state));
  });

  router.get('/google/callback', async (request, response) => {
    const state = typeof request.query.state === 'string' ? request.query.state : '';
    const code = typeof request.query.code === 'string' ? request.query.code : '';
    const expected = readCookie(request, cookieNames.state) ?? '';
    clearStateCookie(response, production);
    if (!code || !state || !expected || !safeEqual(state, expected)) return response.status(400).json({ error: { code: 'INVALID_OAUTH_STATE', message: 'Invalid OAuth state' } });
    const profile = await provider.exchange(code);
    const user = await repository.upsertGoogleUser(profile);
    const access = await tokens.signAccessToken(user);
    const refresh = tokens.newRefreshToken();
    await repository.saveRefresh({ tokenHash: refresh.hash, userId: user.id, familyId: refresh.familyId, expiresAt: refreshExpiry() });
    setAuthCookies(response, access, refresh.value, production);
    response.redirect('/');
  });

  router.get('/me', requireUser(tokens), async (_request, response) => {
    const claims = response.locals.user as { sub: string };
    const user = await repository.findUserById(claims.sub);
    if (!user) return response.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
    response.json({ user });
  });

  router.post('/refresh', async (request, response) => {
    const value = readCookie(request, cookieNames.refresh);
    if (!value) return response.status(401).json({ error: { code: 'INVALID_REFRESH', message: 'Invalid refresh token' } });
    const hash = tokens.hashRefreshToken(value);
    const current = await repository.findRefresh(hash);
    if (!current || current.expiresAt <= new Date()) return response.status(401).json({ error: { code: 'INVALID_REFRESH', message: 'Invalid refresh token' } });
    if (current.revokedAt) {
      await repository.revokeFamily(current.familyId);
      clearAuthCookies(response, production);
      return response.status(401).json({ error: { code: 'REFRESH_REUSE', message: 'Refresh token reuse detected' } });
    }
    const user = await repository.findUserById(current.userId);
    if (!user) return response.status(401).json({ error: { code: 'INVALID_REFRESH', message: 'Invalid refresh token' } });
    const next = tokens.newRefreshToken();
    const replacement = { tokenHash: next.hash, userId: user.id, familyId: current.familyId, expiresAt: refreshExpiry() };
    if (!(await repository.rotateRefresh(hash, replacement))) {
      await repository.revokeFamily(current.familyId);
      return response.status(401).json({ error: { code: 'REFRESH_REUSE', message: 'Refresh token reuse detected' } });
    }
    setAuthCookies(response, await tokens.signAccessToken(user), next.value, production);
    response.sendStatus(204);
  });

  router.post('/logout', async (request, response) => {
    const value = readCookie(request, cookieNames.refresh);
    if (value) {
      const current = await repository.findRefresh(tokens.hashRefreshToken(value));
      if (current) await repository.revokeFamily(current.familyId);
    }
    clearAuthCookies(response, production);
    response.sendStatus(204);
  });
  return router;
}
