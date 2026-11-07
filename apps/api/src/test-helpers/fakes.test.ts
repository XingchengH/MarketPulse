import { describe, expect, it, vi } from 'vitest';
import { FakeGoogleIdentityProvider } from './fake-google.js';
import { FakeMarketDataProvider } from './fake-provider.js';

describe('controlled integration fakes', () => {
  it('exchanges only its explicit test authorization code', async () => {
    const google = new FakeGoogleIdentityProvider({ subject: 'admin-1', email: 'admin@example.test', name: 'Test Admin' });
    expect(google.authorizationUrl('state')).toContain('state=state');
    await expect(google.exchange('fake-google-code')).resolves.toMatchObject({ email: 'admin@example.test' });
    await expect(google.exchange('wrong')).rejects.toThrow('Invalid fake Google authorization code');
  });

  it('emits real-shaped events directly through its in-process handle', async () => {
    const provider = new FakeMarketDataProvider();
    const listener = vi.fn();
    provider.onEvent(listener);
    await provider.connect(['AAPL']);
    provider.handle.emitTrade({ symbol: 'AAPL', price: 201.5, size: 3, providerTimestamp: '2026-11-05T17:00:00.000Z', receivedAt: '2026-11-05T17:00:00.040Z' });
    expect(listener).toHaveBeenCalledWith({ provider: 'alpaca', feed: 'iex', type: 'trade', symbol: 'AAPL', price: 201.5, size: 3, providerTimestamp: '2026-11-05T17:00:00.000Z', receivedAt: '2026-11-05T17:00:00.040Z' });
  });
});
