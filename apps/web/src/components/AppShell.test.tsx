import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthGate } from '../auth/AuthGate';
import { makeStore } from '../store';
import { connectSocket } from '../socket';
import { AppShell } from './AppShell';

const { socket, handlers } = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  return { handlers, socket: { on: vi.fn((event: string, handler: (...args: unknown[]) => void) => { handlers.set(event, handler); }), io: { on: vi.fn() }, close: vi.fn(), disconnect: vi.fn(), connect: vi.fn() } };
});
vi.mock('socket.io-client', () => ({ io: () => socket }));
const reply = (body?: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status });
const user = { id: '1', name: 'Morgan Lee', email: 'morgan@example.com', role: 'viewer' };

function renderWorkspace(navigateToGoogle = vi.fn()) {
  const store = makeStore();
  function Workspace() {
    useEffect(() => connectSocket(store), []);
    return <AppShell navigateToGoogle={navigateToGoogle}><h1>Workspace content</h1></AppShell>;
  }
  render(<Provider store={store}><MemoryRouter><AuthGate><Workspace /></AuthGate></MemoryRouter></Provider>);
  return { store, navigateToGoogle };
}

function mockServer(cleanupRequest: (url: string) => Promise<Response> = async () => reply(undefined, 204)) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/setup/status')) return reply({ configured: true, services: { mongodb: 'ready', googleOAuth: 'ready', alpaca: 'ready', tokens: 'ready' } });
    if (url.endsWith('/auth/me')) return reply({ user });
    if (url.includes('/alerts')) return reply({ alerts: [] });
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('include');
    return cleanupRequest(url);
  });
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); handlers.clear(); });

describe('application profile menu', () => {
  it('exposes navigation and profile details with keyboard-accessible account actions', async () => {
    mockServer();
    renderWorkspace();
    const keyboard = userEvent.setup();
    const profile = await screen.findByRole('button', { name: 'Account menu for Morgan Lee' });
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Overview/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { name: 'Workspace content' }));
    expect(profile).toHaveAttribute('aria-haspopup', 'menu');
    profile.focus();
    await keyboard.keyboard('{Enter}');
    const menu = screen.getByRole('menu', { name: 'Account actions' });
    expect(profile).toHaveAttribute('aria-expanded', 'true');
    expect(within(menu).getByText('Morgan Lee')).toBeInTheDocument();
    expect(within(menu).getByText('morgan@example.com')).toBeInTheDocument();
    expect(within(menu).getByText('viewer')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Switch account' })).toHaveFocus();
    await keyboard.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toHaveFocus();
    await keyboard.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(profile).toHaveFocus();
    await keyboard.click(profile);
    await keyboard.click(screen.getByRole('heading', { name: 'Workspace content' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await keyboard.click(profile);
    await keyboard.click(screen.getByRole('link', { name: /Live feeds/ }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('signs out once, clears cached data, returns to login, and closes the live socket', async () => {
    let finish!: (response: Response) => void;
    const fetcher = mockServer(() => new Promise(resolve => { finish = resolve; }));
    const { store, navigateToGoogle } = renderWorkspace();
    const keyboard = userEvent.setup();
    await keyboard.click(await screen.findByRole('button', { name: 'Account menu for Morgan Lee' }));
    const signOut = screen.getByRole('menuitem', { name: 'Sign out' });
    await keyboard.dblClick(signOut);
    expect(signOut).toBeDisabled();
    // Chromium blurs a focused button when it becomes disabled.
    fireEvent.blur(signOut, { relatedTarget: null });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Switch account' })).toBeDisabled();
    expect(fetcher.mock.calls.filter(([url]) => String(url) === '/api/auth/logout')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Workspace content' })).toBeInTheDocument();
    await act(async () => finish(reply(undefined, 204)));
    expect(await screen.findByRole('link', { name: 'Continue with Google' })).toBeInTheDocument();
    expect(store.getState().api.queries).toEqual({});
    expect(socket.close).toHaveBeenCalledOnce();
    expect(navigateToGoogle).not.toHaveBeenCalled();
    expect(fetcher.mock.calls.filter(([url]) => String(url) === '/api/auth/me')).toHaveLength(1);
  });

  it('waits for pending renewal before sign-out and cannot reopen its socket afterward', async () => {
    let renew!: (response: Response) => void;
    const fetcher = mockServer(async url => url === '/api/auth/refresh' ? new Promise(resolve => { renew = resolve; }) : reply(undefined, 204));
    renderWorkspace();
    const keyboard = userEvent.setup();
    await keyboard.click(await screen.findByRole('button', { name: 'Account menu for Morgan Lee' }));
    act(() => handlers.get('disconnect')?.('io server disconnect'));
    await keyboard.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(fetcher.mock.calls.some(([url]) => String(url) === '/api/auth/logout')).toBe(false);
    await act(async () => renew(reply(undefined, 204)));
    expect(await screen.findByRole('link', { name: 'Continue with Google' })).toBeInTheDocument();
    const reconnects = socket.connect.mock.calls.length;
    act(() => handlers.get('disconnect')?.('io server disconnect'));
    await act(async () => Promise.resolve());
    expect(socket.close).toHaveBeenCalledOnce();
    expect(socket.connect).toHaveBeenCalledTimes(reconnects);
    expect(fetcher.mock.calls.map(([url]) => String(url)).slice(-2)).toEqual(['/api/auth/refresh', '/api/auth/logout']);
  });

  it('cleans up before navigating to the Google account chooser', async () => {
    let finish!: (response: Response) => void;
    const fetcher = mockServer(() => new Promise(resolve => { finish = resolve; }));
    const { store, navigateToGoogle } = renderWorkspace();
    const keyboard = userEvent.setup();
    await keyboard.click(await screen.findByRole('button', { name: 'Account menu for Morgan Lee' }));
    await keyboard.dblClick(screen.getByRole('menuitem', { name: 'Switch account' }));
    expect(fetcher.mock.calls.filter(([url]) => String(url) === '/api/auth/switch-account')).toHaveLength(1);
    expect(navigateToGoogle).not.toHaveBeenCalled();
    await act(async () => finish(reply(undefined, 204)));
    await waitFor(() => expect(navigateToGoogle).toHaveBeenCalledExactlyOnceWith('/api/auth/google?select_account=true'));
    expect(store.getState().api.queries).toEqual({});
    expect(socket.close).toHaveBeenCalledOnce();
  });

  it.each(['Sign out', 'Switch account'])('keeps the session and offers retry when %s fails', async action => {
    let attempts = 0;
    mockServer(async () => ++attempts === 1 ? reply({ error: { message: 'Unavailable' } }, 503) : reply(undefined, 204));
    const { navigateToGoogle } = renderWorkspace();
    const keyboard = userEvent.setup();
    await keyboard.click(await screen.findByRole('button', { name: 'Account menu for Morgan Lee' }));
    await keyboard.click(screen.getByRole('menuitem', { name: action }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please try again');
    expect(screen.getByRole('menuitem', { name: action })).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'Workspace content' })).toBeInTheDocument();
    expect(socket.close).not.toHaveBeenCalled();
    expect(navigateToGoogle).not.toHaveBeenCalled();
    await keyboard.click(screen.getByRole('menuitem', { name: action }));
    await waitFor(() => expect(socket.close).toHaveBeenCalledOnce());
    expect(attempts).toBe(2);
  });
});
