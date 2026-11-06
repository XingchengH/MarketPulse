import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
const ack = vi.fn();
vi.mock('../api', () => ({ useAlertsQuery: () => ({ data: { alerts: [{ _id:'a1', symbol:'AAPL', metric:'observedLatencyMs', severity:'warning', status:'open', value:9, threshold:5, lastObservedAt:'2026-11-05T00:00:00Z' }] } }), useSessionQuery: () => ({ data: { user: { role:'operator' } } }), useAcknowledgeAlertMutation: () => [ack, { isLoading:false }] }));
import { AlertsPage } from './AlertsPage';
afterEach(() => { cleanup(); ack.mockReset(); });
describe('alert acknowledgement', () => {
  it('reports success only after the request succeeds', async () => { ack.mockReturnValue({ unwrap: () => Promise.resolve({}) }); render(<AlertsPage/>); await userEvent.click(screen.getByRole('button', { name:'Acknowledge' })); expect(await screen.findByText('Alert acknowledged.')).toBeInTheDocument(); });
  it('keeps the alert open and reports an error when the request fails', async () => { ack.mockReturnValue({ unwrap: () => Promise.reject(new Error()) }); render(<AlertsPage/>); await userEvent.click(screen.getByRole('button', { name:'Acknowledge' })); expect(await screen.findByText(/remains open/)).toBeInTheDocument(); expect(screen.getByText(/AAPL/)).toBeInTheDocument(); });
});
