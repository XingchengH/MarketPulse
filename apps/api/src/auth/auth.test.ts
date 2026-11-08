import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createAuthRouter, type AuthRepository, type PublicUser, type RefreshRecord } from '../routes/auth.js';
import { createTokenService } from './tokens.js';

const config = {
  nodeEnv: 'test' as const,
  webOrigin: 'http://localhost:5173',
  accessTokenSecret: 'access-secret-used-only-for-tests',
  refreshTokenPepper: 'refresh-pepper-used-only-for-tests',
};

function cookieValue(setCookies: string[], name: string): string {
  const cookie = setCookies.find((entry) => entry.startsWith(`${name}=`));
  if (!cookie) throw new Error(`missing ${name} cookie`);
  return cookie.split(';', 1)[0]!.slice(name.length + 1);
}

function makeRepository(): AuthRepository & { refreshes: Map<string, RefreshRecord>; user: PublicUser | undefined } {
  const refreshes = new Map<string, RefreshRecord>();
  return {
    refreshes,
    user: undefined,
    async upsertGoogleUser(profile) {
      this.user ??= { id: 'user-1', email: profile.email, name: profile.name, picture: profile.picture, role: 'viewer' };
      return this.user;
    },
    async findUserById(id) {
      return this.user?.id === id ? this.user : null;
    },
    async saveRefresh(record) {
      refreshes.set(record.tokenHash, record);
    },
    async findRefresh(tokenHash) {
      return refreshes.get(tokenHash) ?? null;
    },
    async rotateRefresh(currentHash, replacement) {
      const current = refreshes.get(currentHash);
      if (!current || current.revokedAt) return false;
      current.revokedAt = new Date();
      current.replacedByHash = replacement.tokenHash;
      refreshes.set(replacement.tokenHash, replacement);
      return true;
    },
    async revokeFamily(familyId) {
      for (const record of refreshes.values()) if (record.familyId === familyId) record.revokedAt ??= new Date();
    },
  };
}

function makeApp(repository: AuthRepository, tokenTtl = '15m') {
  const provider = {
    authorizationUrl: (state: string, options?: { selectAccount?: boolean }) => `https://accounts.example/authorize?state=${state}${options?.selectAccount ? '&prompt=select_account' : ''}`,
    exchange: async () => ({ subject: 'google-123', email: 'viewer@example.com', name: 'Viewer', picture: 'https://example.com/p.png' }),
  };
  const app = express();
  app.use('/api/auth', createAuthRouter({
    provider,
    repository,
    tokens: createTokenService(config.accessTokenSecret, config.refreshTokenPepper, tokenTtl),
    nodeEnv: config.nodeEnv,
    webOrigin: config.webOrigin,
  }));
  return app;
}

describe('authentication', () => {
  let repository: ReturnType<typeof makeRepository>;

  beforeEach(() => { repository = makeRepository(); });

  it.each(['', '?select_account=false', '?select_account=1', '?select_account=TRUE', '?select_account=true&select_account=false', '?select_account[enabled]=true'])('does not select an account for %s', async query => {
    const response = await request(makeApp(repository)).get(`/api/auth/google${query}`);
    expect(new URL(response.headers.location).searchParams.has('prompt')).toBe(false);
  });

  it('selects a Google account when requested and retains the OAuth state cookie', async () => {
    const agent = request.agent(makeApp(repository));
    const start = await agent.get('/api/auth/google?select_account=true');
    const state = cookieValue(start.headers['set-cookie'], 'oauth_state');
    const url = new URL(start.headers.location);
    expect(url.searchParams.get('prompt')).toBe('select_account');
    expect(url.searchParams.get('state')).toBe(state);
    expect((await agent.get(`/api/auth/google/callback?code=ok&state=${state}`)).status).toBe(302);
  });

  it.each(['logout', 'switch-account'])('%s clears cookies without a refresh cookie', async route => {
    const response = await request(makeApp(repository)).post(`/api/auth/${route}`);
    expect(response.status).toBe(204);
    expect(response.headers.location).toBeUndefined();
    expect(cookieValue(response.headers['set-cookie'], 'access_token')).toBe('');
    expect(cookieValue(response.headers['set-cookie'], 'refresh_token')).toBe('');
  });

  it('creates a new Google user as viewer and never returns token values', async () => {
    const agent = request.agent(makeApp(repository));
    const start = await agent.get('/api/auth/google');
    const state = cookieValue(start.headers['set-cookie'], 'oauth_state');
    const callback = await agent.get(`/api/auth/google/callback?code=ok&state=${state}`);

    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe('http://localhost:5173/');
    expect(repository.user).toMatchObject({ email: 'viewer@example.com', role: 'viewer' });
    expect(JSON.stringify(callback.body)).not.toContain('token');
    const me = await agent.get('/api/auth/me');
    expect(me.body).toEqual({ user: repository.user });
  });

  it('rejects an OAuth state mismatch before exchanging the code', async () => {
    const agent = request.agent(makeApp(repository));
    await agent.get('/api/auth/google');
    const response = await agent.get('/api/auth/google/callback?code=ok&state=wrong');
    expect(response.status).toBe(400);
    expect(repository.user).toBeUndefined();
  });

  it('rejects an expired access token', async () => {
    repository.user = { id: 'user-1', email: 'x@example.com', name: 'X', role: 'viewer' };
    const tokens = createTokenService(config.accessTokenSecret, config.refreshTokenPepper, '-1s');
    const access = await tokens.signAccessToken(repository.user);
    const response = await request(makeApp(repository)).get('/api/auth/me').set('Cookie', `access_token=${access}`);
    expect(response.status).toBe(401);
  });

  it('rotates refresh tokens and revokes the family when an invalidated token is reused', async () => {
    const agent = request.agent(makeApp(repository));
    const start = await agent.get('/api/auth/google');
    const state = cookieValue(start.headers['set-cookie'], 'oauth_state');
    const login = await agent.get(`/api/auth/google/callback?code=ok&state=${state}`);
    const original = cookieValue(login.headers['set-cookie'], 'refresh_token');

    const rotated = await request(makeApp(repository)).post('/api/auth/refresh').set('Cookie', `refresh_token=${original}`);
    expect(rotated.status).toBe(204);
    const replacement = cookieValue(rotated.headers['set-cookie'], 'refresh_token');
    expect(replacement).not.toBe(original);

    const reuse = await request(makeApp(repository)).post('/api/auth/refresh').set('Cookie', `refresh_token=${original}`);
    expect(reuse.status).toBe(401);
    const rejectedReplacement = await request(makeApp(repository)).post('/api/auth/refresh').set('Cookie', `refresh_token=${replacement}`);
    expect(rejectedReplacement.status).toBe(401);
  });

  it('allows only one concurrent refresh and reliably compromises its successor family', async () => {
    const agent = request.agent(makeApp(repository));
    const start = await agent.get('/api/auth/google');
    const state = cookieValue(start.headers['set-cookie'], 'oauth_state');
    const login = await agent.get(`/api/auth/google/callback?code=ok&state=${state}`);
    const original = cookieValue(login.headers['set-cookie'], 'refresh_token');

    const responses = await Promise.all([
      request(makeApp(repository)).post('/api/auth/refresh').set('Cookie', `refresh_token=${original}`),
      request(makeApp(repository)).post('/api/auth/refresh').set('Cookie', `refresh_token=${original}`),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([204, 401]);
    const winner = responses.find((response) => response.status === 204)!;
    const successor = cookieValue(winner.headers['set-cookie'], 'refresh_token');
    expect((await request(makeApp(repository)).post('/api/auth/refresh').set('Cookie', `refresh_token=${successor}`)).status).toBe(401);
  });

  it('treats reuse as compromise even after the revoked token has expired', async () => {
    const agent = request.agent(makeApp(repository));
    const start = await agent.get('/api/auth/google');
    const state = cookieValue(start.headers['set-cookie'], 'oauth_state');
    const login = await agent.get(`/api/auth/google/callback?code=ok&state=${state}`);
    const original = cookieValue(login.headers['set-cookie'], 'refresh_token');
    const rotated = await request(makeApp(repository)).post('/api/auth/refresh').set('Cookie', `refresh_token=${original}`);
    const successor = cookieValue(rotated.headers['set-cookie'], 'refresh_token');
    repository.refreshes.get(createTokenService(config.accessTokenSecret, config.refreshTokenPepper).hashRefreshToken(original))!.expiresAt = new Date(0);

    expect((await request(makeApp(repository)).post('/api/auth/refresh').set('Cookie', `refresh_token=${original}`)).status).toBe(401);
    expect((await request(makeApp(repository)).post('/api/auth/refresh').set('Cookie', `refresh_token=${successor}`)).status).toBe(401);
  });

  it.each(['logout', 'switch-account'])('revokes the whole refresh family and clears cookies on %s', async route => {
    const agent = request.agent(makeApp(repository));
    const start = await agent.get('/api/auth/google');
    const state = cookieValue(start.headers['set-cookie'], 'oauth_state');
    const login = await agent.get(`/api/auth/google/callback?code=ok&state=${state}`);
    const refresh = cookieValue(login.headers['set-cookie'], 'refresh_token');
    const rotated = await request(makeApp(repository)).post('/api/auth/refresh').set('Cookie', `refresh_token=${refresh}`);
    const successor = cookieValue(rotated.headers['set-cookie'], 'refresh_token');
    const logout = await request(makeApp(repository)).post(`/api/auth/${route}`).set('Cookie', `refresh_token=${successor}`);
    expect(logout.status).toBe(204);
    expect(logout.headers['set-cookie'].join(';')).toContain('access_token=;');
    expect(cookieValue(logout.headers['set-cookie'], 'refresh_token')).toBe('');
    expect(logout.headers.location).toBeUndefined();
    expect(logout.text).toBe('');
    expect([...repository.refreshes.values()].every(record => record.revokedAt)).toBe(true);
    expect((await request(makeApp(repository)).post('/api/auth/refresh').set('Cookie', `refresh_token=${refresh}`)).status).toBe(401);
  });
});
