import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
const update = vi.fn(), create = vi.fn(), toggle = vi.fn(), retry = vi.fn(); let currentRole = 'viewer', ruleState='ready', historyState='ready';
vi.mock('../api', () => ({
  useUpdateRuleMutation: () => [update], useCreateRuleMutation: () => [create],
  useRulesQuery: () => ruleState==='loading'?{isLoading:true}:{ data: ruleState==='error'?undefined:{ rules:[rule] }, isError:ruleState==='error', refetch:retry },
  useSessionQuery: () => ({ data: { user: { role: currentRole } } }),
  useToggleRuleMutation: () => [toggle], useRuleVersionsQuery: () => historyState==='loading'?{isLoading:true}:historyState==='error'?{isError:true,refetch:retry}:{data:{versions:[]}},
}));
import { RuleDialog } from './RuleDialog';
const rule = { _id:'r1', version:7, updatedAt:'', name:'Latency', scope:{kind:'all'} as const, metric:'observedLatencyMs' as const, operator:'gt' as const, threshold:10, durationSeconds:60, severity:'warning' as const, enabled:true };
import { RulesPage } from './RulesPage';
import { RuleHistoryDialog } from './RuleHistoryDialog';
afterEach(() => { cleanup(); update.mockReset(); toggle.mockReset(); retry.mockReset(); currentRole='viewer'; ruleState='ready'; historyState='ready'; });
describe('rule editing', () => { it('sends the current version and offers refresh on 409', async () => { update.mockReturnValue({ unwrap: () => Promise.reject({ status:409 }) }); const conflict=vi.fn(); render(<RuleDialog rule={rule} onClose={vi.fn()} onConflict={conflict}/>); await userEvent.click(screen.getByRole('button',{name:'Save changes'})); expect(update).toHaveBeenCalledWith(expect.objectContaining({ id:'r1', version:7 })); expect(conflict).toHaveBeenCalled(); }); });
describe('role access', () => { it('disables viewer controls with an explanation', () => { render(<RulesPage/>); expect(screen.getByRole('button', { name:'Create rule' })).toBeDisabled(); expect(screen.getByRole('button', { name:'Create rule' })).toHaveAttribute('title', 'Admin role is required to change rules.'); expect(screen.getByRole('button', { name:'Edit' })).toBeDisabled(); }); });
describe('toggle conflict', () => { it('closes mutation flow and offers an accessible refresh action on 409', async () => { currentRole = 'admin'; toggle.mockReturnValue({ unwrap: () => Promise.reject({ status:409 }) }); render(<RulesPage/>); await userEvent.click(screen.getByRole('switch')); expect(await screen.findByRole('alert')).toHaveTextContent('changed after you opened it'); expect(screen.getByRole('button', { name:'Refresh current version' })).toBeInTheDocument(); }); });
describe('rule query states',()=>{it('distinguishes loading and error with retry',()=>{ruleState='loading';const view=render(<RulesPage/>);expect(screen.getByText('Loading monitoring rules…')).toBeInTheDocument();view.unmount();ruleState='error';render(<RulesPage/>);expect(screen.getByText('Monitoring rules are unavailable')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Retry'})).toBeInTheDocument();});it('distinguishes history loading and error with retry',()=>{historyState='loading';const view=render(<RuleHistoryDialog rule={rule} onClose={vi.fn()}/>);expect(screen.getByText('Loading rule history…')).toBeInTheDocument();view.unmount();historyState='error';render(<RuleHistoryDialog rule={rule} onClose={vi.fn()}/>);expect(screen.getByText('Rule history is unavailable')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Retry'})).toBeInTheDocument();});});
