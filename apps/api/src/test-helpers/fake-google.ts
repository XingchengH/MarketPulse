import type { GoogleIdentityProvider, GoogleProfile } from '../auth/google-provider.js';

/** Test-only OAuth double. Never select this provider from production environment variables. */
export class FakeGoogleIdentityProvider implements GoogleIdentityProvider {
  constructor(private readonly profile: GoogleProfile) {
    if (process.env.NODE_ENV !== 'test') throw new Error('Fake Google provider is restricted to NODE_ENV=test');
  }

  authorizationUrl(state: string): string {
    return `http://127.0.0.1/fake-google/authorize?state=${encodeURIComponent(state)}`;
  }

  async exchange(code: string): Promise<GoogleProfile> {
    if (code !== 'fake-google-code') throw new Error('Invalid fake Google authorization code');
    return this.profile;
  }
}
