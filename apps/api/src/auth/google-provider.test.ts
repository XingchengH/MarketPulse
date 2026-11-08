import { describe, expect, it } from 'vitest';
import { createGoogleIdentityProvider, parseGoogleProfile } from './google-provider.js';

describe('Google authorization', () => {
  it('asks for account selection only when explicitly enabled and preserves state', () => {
    const provider = createGoogleIdentityProvider('client', 'secret', 'http://localhost/callback');
    for (const options of [undefined, { selectAccount: false }, { selectAccount: true }]) {
      const url = new URL(provider.authorizationUrl('oauth-state', options));
      expect(url.searchParams.get('state')).toBe('oauth-state');
      expect(url.searchParams.get('prompt')).toBe(options?.selectAccount ? 'select_account' : null);
    }
  });
});

describe('Google profile validation', () => {
  it('accepts only explicitly verified email identities', () => {
    expect(parseGoogleProfile({ sub: '123', email: 'user@example.com', email_verified: true, name: 'User' })).toEqual({
      subject: '123', email: 'user@example.com', name: 'User', picture: undefined,
    });
    expect(() => parseGoogleProfile({ sub: '123', email: 'user@example.com', email_verified: false, name: 'User' })).toThrow(/unverified/);
    expect(() => parseGoogleProfile({ sub: '123', email: 'user@example.com', name: 'User' })).toThrow(/unverified/);
  });
});
