import { describe, expect, it } from 'vitest';
import { parseGoogleProfile } from './google-provider.js';

describe('Google profile validation', () => {
  it('accepts only explicitly verified email identities', () => {
    expect(parseGoogleProfile({ sub: '123', email: 'user@example.com', email_verified: true, name: 'User' })).toEqual({
      subject: '123', email: 'user@example.com', name: 'User', picture: undefined,
    });
    expect(() => parseGoogleProfile({ sub: '123', email: 'user@example.com', email_verified: false, name: 'User' })).toThrow(/unverified/);
    expect(() => parseGoogleProfile({ sub: '123', email: 'user@example.com', name: 'User' })).toThrow(/unverified/);
  });
});
