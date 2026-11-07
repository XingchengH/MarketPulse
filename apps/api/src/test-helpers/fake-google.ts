import type { GoogleIdentityProvider, GoogleProfile } from '../auth/google-provider.js';

/** Test-only OAuth double. Never select this provider from production environment variables. */
export class FakeGoogleIdentityProvider implements GoogleIdentityProvider {
  constructor(private readonly profile: GoogleProfile, private readonly callbackUrl = 'http://localhost:3000/api/auth/google/callback') {
    if (process.env.NODE_ENV !== 'test') throw new Error('Fake Google provider is restricted to NODE_ENV=test');
  }

  authorizationUrl(state: string): string {
    const url = new URL(this.callbackUrl);
    url.searchParams.set('code', 'fake-google-code');
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchange(code: string): Promise<GoogleProfile> {
    if (code !== 'fake-google-code') throw new Error('Invalid fake Google authorization code');
    return this.profile;
  }
}
