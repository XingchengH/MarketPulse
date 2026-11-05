import { OAuth2Client } from 'arctic';

export interface GoogleProfile {
  subject: string;
  email: string;
  name: string;
  picture?: string;
}

export interface GoogleIdentityProvider {
  authorizationUrl(state: string): string;
  exchange(code: string): Promise<GoogleProfile>;
}

export function parseGoogleProfile(value: unknown): GoogleProfile {
  const profile = value as { sub?: unknown; email?: unknown; email_verified?: unknown; name?: unknown; picture?: unknown };
  if (
    typeof profile.sub !== 'string'
    || typeof profile.email !== 'string'
    || profile.email_verified !== true
    || typeof profile.name !== 'string'
    || (profile.picture !== undefined && typeof profile.picture !== 'string')
  ) throw new Error('Google profile is incomplete or email is unverified');
  return { subject: profile.sub, email: profile.email, name: profile.name, picture: profile.picture };
}

export function createGoogleIdentityProvider(clientId: string, clientSecret: string, redirectUri: string): GoogleIdentityProvider {
  const client = new OAuth2Client(clientId, clientSecret, redirectUri);
  return {
    authorizationUrl(state) {
      return client.createAuthorizationURL(
        'https://accounts.google.com/o/oauth2/v2/auth',
        state,
        ['openid', 'email', 'profile'],
      ).toString();
    },
    async exchange(code) {
      const tokens = await client.validateAuthorizationCode('https://oauth2.googleapis.com/token', code, null);
      const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { authorization: `Bearer ${tokens.accessToken()}` },
      });
      if (!response.ok) throw new Error('Google userinfo request failed');
      return parseGoogleProfile(await response.json());
    },
  };
}
