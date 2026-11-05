import type { Request, Response } from 'express';

export const cookieNames = { access: 'access_token', refresh: 'refresh_token', state: 'oauth_state' } as const;

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

function options(production: boolean, maxAge: number) {
  return { httpOnly: true, secure: production, sameSite: 'lax' as const, path: '/', maxAge };
}

export function setAuthCookies(response: Response, access: string, refresh: string, production: boolean): void {
  response.cookie(cookieNames.access, access, options(production, 15 * 60 * 1000));
  response.cookie(cookieNames.refresh, refresh, options(production, 30 * 24 * 60 * 60 * 1000));
}

export function clearAuthCookies(response: Response, production: boolean): void {
  response.clearCookie(cookieNames.access, options(production, 0));
  response.clearCookie(cookieNames.refresh, options(production, 0));
}

export function setStateCookie(response: Response, state: string, production: boolean): void {
  response.cookie(cookieNames.state, state, options(production, 10 * 60 * 1000));
}

export function clearStateCookie(response: Response, production: boolean): void {
  response.clearCookie(cookieNames.state, options(production, 0));
}
