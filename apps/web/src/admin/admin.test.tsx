import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Provider } from 'react-redux';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const update = vi.fn(() => ({ unwrap: () => Promise.resolve({}) }));
const retryUsers = vi.fn();
let usersError = false;
let role: 'admin' | 'operator' | 'viewer' = 'admin';
vi.mock('../api', async importOriginal => ({
  ...await importOriginal<typeof import('../api')>(),
  useSessionQuery: () => ({ data: { user: { id: 'me', name: 'Morgan Lee', email: 'm@example.com', role } }, isLoading: false }),
  useAlertsQuery: () => ({ data: { alerts: [] } }),
  useUsersQuery: () => ({ data: usersError ? undefined : { users: [{ id: 'u', name: 'Alex User', email: 'alex@example.com', role: 'viewer', lastLoginAt: '2026-01-01T00:00:00Z' }] }, isLoading: false, isError: usersError, refetch: retryUsers }),
  useUpdateUserRoleMutation: () => [update, { isLoading: false }],
}));
import { AdminPage } from './AdminPage';
import { AdminRoute } from '../router';
import { AppShell } from '../components/AppShell';
import { makeStore } from '../store';

const renderShell = () => render(<Provider store={makeStore()}><MemoryRouter><AppShell><p>Content</p></AppShell></MemoryRouter></Provider>);

describe('admin page', () => {
  beforeEach(() => { role = 'admin'; usersError = false; update.mockClear(); retryUsers.mockClear(); });
  it('offers user management without obsolete global watchlist controls', () => { render(<AdminPage/>); expect(screen.getByRole('heading', { name: 'Users' })).toBeInTheDocument(); expect(screen.queryByRole('heading', { name: 'Watchlist' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Add symbol' })).not.toBeInTheDocument(); });
  it('confirms a role change naming the user and new role', () => { render(<AdminPage/>); fireEvent.change(screen.getByLabelText('Role for Alex User'), { target: { value: 'operator' } }); expect(screen.getByRole('dialog')).toHaveTextContent('Alex User'); expect(screen.getByRole('dialog')).toHaveTextContent('operator'); });
  it('rejects direct navigation for a non-admin', () => { role = 'viewer'; render(<MemoryRouter initialEntries={['/admin']}><Routes><Route path="/" element={<p>Overview</p>}/><Route path="/admin" element={<AdminRoute/>}/></Routes></MemoryRouter>); expect(screen.getByText('Overview')).toBeInTheDocument(); });
  it('shows Administration navigation only to admins', () => { role = 'viewer'; const viewer = renderShell(); expect(screen.queryByRole('link', { name: 'Administration' })).not.toBeInTheDocument(); viewer.unmount(); role = 'operator'; const operator = renderShell(); expect(screen.queryByRole('link', { name: 'Administration' })).not.toBeInTheDocument(); operator.unmount(); role = 'admin'; renderShell(); expect(screen.getByRole('link', { name: 'Administration' })).toBeInTheDocument(); });
  it('renders a retryable initial user query error', () => { usersError = true; render(<AdminPage/>); fireEvent.click(screen.getByRole('button', { name: 'Retry users' })); expect(retryUsers).toHaveBeenCalledOnce(); });
});
