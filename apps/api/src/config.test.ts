import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const localEnv = {
  NODE_ENV: 'development',
  PORT: '4000',
  WEB_ORIGIN: 'http://localhost:5173',
  MONGODB_URI: 'mongodb://localhost:27017/marketpulse',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  GOOGLE_REDIRECT_URI: '',
  ALPACA_API_KEY: '',
  ALPACA_API_SECRET: '',
  ACCESS_TOKEN_SECRET: 'local-only-access-token-secret',
  REFRESH_TOKEN_PEPPER: 'local-only-refresh-token-pepper',
};

describe('loadConfig', () => {
  it('loads local configuration while allowing missing provider credentials', () => {
    expect(loadConfig(localEnv)).toMatchObject({
      nodeEnv: 'development',
      port: 4000,
      webOrigin: 'http://localhost:5173',
      google: { clientId: '', clientSecret: '', redirectUri: 'http://localhost:5173/api/auth/google/callback' },
      alpaca: { apiKey: '', apiSecret: '' },
    });
  });

  it('rejects malformed required settings', () => {
    expect(() => loadConfig({ ...localEnv, PORT: 'nope' })).toThrow(/PORT/);
    expect(() => loadConfig({ ...localEnv, WEB_ORIGIN: 'not-a-url' })).toThrow(/WEB_ORIGIN/);
    expect(() => loadConfig({ ...localEnv, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('rejects short production token secrets', () => {
    expect(() =>
      loadConfig({
        ...localEnv,
        NODE_ENV: 'production',
        ACCESS_TOKEN_SECRET: 'short',
        REFRESH_TOKEN_PEPPER: 'also-short',
      }),
    ).toThrow(/32 characters/);
  });

  it('rejects whitespace-only production secrets without trimming legitimate values', () => {
    expect(() =>
      loadConfig({
        ...localEnv,
        NODE_ENV: 'production',
        GOOGLE_CLIENT_ID: 'google-id',
        GOOGLE_CLIENT_SECRET: 'google-secret',
        GOOGLE_REDIRECT_URI: 'https://example.com/callback',
        ALPACA_API_KEY: 'alpaca-key',
        ALPACA_API_SECRET: 'alpaca-secret',
        ACCESS_TOKEN_SECRET: ' '.repeat(32),
        REFRESH_TOKEN_PEPPER: 'x'.repeat(32),
      }),
    ).toThrow(/ACCESS_TOKEN_SECRET/);

    const accessTokenSecret = `  ${'x'.repeat(32)}  `;
    expect(
      loadConfig({
        ...localEnv,
        NODE_ENV: 'production',
        GOOGLE_CLIENT_ID: 'google-id',
        GOOGLE_CLIENT_SECRET: 'google-secret',
        GOOGLE_REDIRECT_URI: 'https://example.com/callback',
        ALPACA_API_KEY: 'alpaca-key',
        ALPACA_API_SECRET: 'alpaca-secret',
        ACCESS_TOKEN_SECRET: accessTokenSecret,
        REFRESH_TOKEN_PEPPER: 'x'.repeat(32),
      }).accessTokenSecret,
    ).toBe(accessTokenSecret);
  });

  it('derives the production OAuth callback from the public web origin', () => {
    const config = loadConfig({
      ...localEnv,
      NODE_ENV: 'production',
      WEB_ORIGIN: 'https://marketpulse.example',
      GOOGLE_CLIENT_ID: 'google-id',
      GOOGLE_CLIENT_SECRET: 'google-secret',
      GOOGLE_REDIRECT_URI: '',
      ALPACA_API_KEY: 'alpaca-key',
      ALPACA_API_SECRET: 'alpaca-secret',
      ACCESS_TOKEN_SECRET: 'x'.repeat(32),
      REFRESH_TOKEN_PEPPER: 'y'.repeat(32),
    });
    expect(config.google.redirectUri).toBe('https://marketpulse.example/api/auth/google/callback');
  });
});
