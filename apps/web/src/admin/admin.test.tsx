import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const add = vi.fn(() => ({ unwrap: () => Promise.resolve({}) }));
const remove = vi.fn(() => ({ unwrap: () => Promise.resolve({}) }));
const update = vi.fn(() => ({ unwrap: () => Promise.resolve({}) }));
let role: 'admin' | 'viewer' = 'admin';
vi.mock('../api', () => ({
  useSessionQuery: () => ({ data: { user: { id: 'me', name: 'Morgan Lee', email: 'm@example.com', role } }, isLoading: false }),
  useWatchlistQuery: () => ({ data: { watchlist: [{ id: '1', symbol: 'AAPL', enabled: true }, { id: '2', symbol: 'MSFT', enabled: true }] }, isLoading: false, refetch: vi.fn() }),
  useAddWatchlistSymbolMutation: () => [add, { isLoading: false }], useRemoveWatchlistSymbolMutation: () => [remove, { isLoading: false }],
  useUsersQuery: () => ({ data: { users: [{ id: 'u', name: 'Alex User', email: 'alex@example.com', role: 'viewer', lastLoginAt: '2026-01-01T00:00:00Z' }] }, isLoading: false }),
  useUpdateUserRoleMutation: () => [update, { isLoading: false }],
}));
import { AdminPage } from './AdminPage';
import { AdminRoute } from '../router';

describe('admin page', () => {
  beforeEach(() => { role = 'admin'; add.mockClear(); update.mockClear(); });
  it('offers accessible watchlist and user tables with mutation feedback', async () => { render(<AdminPage/>); expect(screen.getByRole('heading', { name: 'Watchlist' })).toBeInTheDocument(); expect(screen.getByRole('heading', { name: 'Users' })).toBeInTheDocument(); fireEvent.change(screen.getByLabelText('Symbol'), { target: { value: 'nvda' } }); fireEvent.click(screen.getByRole('button', { name: 'Add symbol' })); await waitFor(() => expect(add).toHaveBeenCalledWith('NVDA')); expect(await screen.findByText('NVDA added')).toBeInTheDocument(); });
  it('confirms a role change naming the user and new role', () => { render(<AdminPage/>); fireEvent.change(screen.getByLabelText('Role for Alex User'), { target: { value: 'operator' } }); expect(screen.getByRole('dialog')).toHaveTextContent('Alex User'); expect(screen.getByRole('dialog')).toHaveTextContent('operator'); });
  it('rejects direct navigation for a non-admin', () => { role = 'viewer'; render(<MemoryRouter initialEntries={['/admin']}><Routes><Route path="/" element={<p>Overview</p>}/><Route path="/admin" element={<AdminRoute/>}/></Routes></MemoryRouter>); expect(screen.getByText('Overview')).toBeInTheDocument(); });
});
