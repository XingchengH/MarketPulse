import { render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { makeStore } from '../store';
import { httpBaseQuery } from '../api';
import { AuthGate } from './AuthGate';

const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const renderGate = () => render(<Provider store={makeStore()}><MemoryRouter><AuthGate><div>private</div></AuthGate></MemoryRouter></Provider>);

describe('startup gate', () => {
  it.each(['/auth/logout', '/auth/switch-account'])('does not renew or retry cleanup rejected with 401 at %s', async url => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(() => reply({ error: { code: 'UNAUTHENTICATED' } }, 401));
    const result = await httpBaseQuery({ url, method: 'POST' }, {} as Parameters<typeof httpBaseQuery>[1], {});
    expect(result.error?.status).toBe(401);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(`/api${url}`, expect.objectContaining({ method: 'POST', credentials: 'include' }));
  });

  it('coalesces refresh rotation and retries concurrent requests after an expired access cookie', async () => {
    let refreshes = 0;
    let protectedCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input);
      if (url === '/api/auth/refresh') { refreshes += 1; return new Response(null, { status: 204 }); }
      protectedCalls += 1;
      if (protectedCalls <= 2) return reply({ error: { code: 'UNAUTHENTICATED' } }, 401);
      return reply({ ok: true });
    });
    const apiContext = {} as Parameters<typeof httpBaseQuery>[1];
    const [first, second] = await Promise.all([
      httpBaseQuery('/overview', apiContext, {}),
      httpBaseQuery('/symbols', apiContext, {}),
    ]);
    expect(first).toEqual({ data: { ok: true } });
    expect(second).toEqual({ data: { ok: true } });
    expect(refreshes).toBe(1);
  });

  it('shows loading, then exact Alpaca setup guidance without requesting the session', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(() => reply({ configured: false, services: { mongodb: 'ready', googleOAuth: 'ready', alpaca: 'missing', tokens: 'ready' } }));
    renderGate();
    expect(screen.getByText('Checking services…')).toBeInTheDocument();
    expect(await screen.findByText('Alpaca credentials are missing')).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('2.90M')).not.toBeInTheDocument();
  });
  it('offers Google login when configured but unauthenticated', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => reply({ configured: true, services: { mongodb: 'ready', googleOAuth: 'ready', alpaca: 'ready', tokens: 'ready' } })).mockImplementationOnce(() => reply({ error: { message: 'Authentication required' } }, 401));
    renderGate();
    expect(await screen.findByRole('link', { name: 'Continue with Google' })).toHaveAttribute('href', '/api/auth/google');
  });
  it('shows a retryable session-service error for 5xx instead of Google login', async () => {
    vi.spyOn(globalThis,'fetch').mockImplementationOnce(()=>reply({configured:true,services:{mongodb:'ready',googleOAuth:'ready',alpaca:'ready',tokens:'ready'}})).mockImplementationOnce(()=>reply({error:{message:'down'}},503));
    renderGate(); expect(await screen.findByText('Session service is unavailable')).toBeInTheDocument(); expect(screen.queryByRole('link',{name:'Continue with Google'})).not.toBeInTheDocument(); expect(screen.getByRole('button',{name:'Retry'})).toBeInTheDocument();
  });
  it('renders a recoverable setup error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    renderGate();
    expect(await screen.findByText('Service status is unavailable')).toBeInTheDocument();
  });
  it('renders protected content for a session', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(() => reply({ configured: true, services: { mongodb: 'ready', googleOAuth: 'ready', alpaca: 'ready', tokens: 'ready' } })).mockImplementationOnce(() => reply({ user: { id: '1', name: 'Analyst', email: 'a@b.test', role: 'viewer' } }));
    renderGate();
    await waitFor(() => expect(screen.getByText('private')).toBeInTheDocument());
  });
});
