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
      const value = await response.json() as { sub?: string; email?: string; name?: string; picture?: string };
      if (!value.sub || !value.email || !value.name) throw new Error('Google profile is incomplete');
      return { subject: value.sub, email: value.email, name: value.name, picture: value.picture };
    },
  };
}
