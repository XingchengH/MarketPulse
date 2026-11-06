import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
const update = vi.fn(), create = vi.fn(), toggle = vi.fn(); let currentRole = 'viewer';
vi.mock('../api', () => ({
  useUpdateRuleMutation: () => [update], useCreateRuleMutation: () => [create],
  useRulesQuery: () => ({ data: { rules: [rule] }, refetch: vi.fn() }),
  useSessionQuery: () => ({ data: { user: { role: currentRole } } }),
  useToggleRuleMutation: () => [toggle], useRuleVersionsQuery: () => ({ data: { versions: [] } }),
}));
import { RuleDialog } from './RuleDialog';
const rule = { _id:'r1', version:7, updatedAt:'', name:'Latency', scope:{kind:'all'} as const, metric:'observedLatencyMs' as const, operator:'gt' as const, threshold:10, durationSeconds:60, severity:'warning' as const, enabled:true };
import { RulesPage } from './RulesPage';
afterEach(() => { cleanup(); update.mockReset(); toggle.mockReset(); currentRole = 'viewer'; });
describe('rule editing', () => { it('sends the current version and offers refresh on 409', async () => { update.mockReturnValue({ unwrap: () => Promise.reject({ status:409 }) }); const conflict=vi.fn(); render(<RuleDialog rule={rule} onClose={vi.fn()} onConflict={conflict}/>); await userEvent.click(screen.getByRole('button',{name:'Save changes'})); expect(update).toHaveBeenCalledWith(expect.objectContaining({ id:'r1', version:7 })); expect(conflict).toHaveBeenCalled(); }); });
describe('role access', () => { it('disables viewer controls with an explanation', () => { render(<RulesPage/>); expect(screen.getByRole('button', { name:'Create rule' })).toBeDisabled(); expect(screen.getByRole('button', { name:'Create rule' })).toHaveAttribute('title', 'Admin role is required to change rules.'); expect(screen.getByRole('button', { name:'Edit' })).toBeDisabled(); }); });
describe('toggle conflict', () => { it('closes mutation flow and offers an accessible refresh action on 409', async () => { currentRole = 'admin'; toggle.mockReturnValue({ unwrap: () => Promise.reject({ status:409 }) }); render(<RulesPage/>); await userEvent.click(screen.getByRole('switch')); expect(await screen.findByRole('alert')).toHaveTextContent('changed after you opened it'); expect(screen.getByRole('button', { name:'Refresh current version' })).toBeInTheDocument(); }); });
