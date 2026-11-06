import { FileClock, Plus } from 'lucide-react';
import { useState } from 'react';
import { useRulesQuery, useSessionQuery, useToggleRuleMutation, type ApiError, type Rule } from '../api';
import { StatusBadge } from '../components/StatusBadge';
import { RuleDialog } from './RuleDialog';
import { RuleHistoryDialog } from './RuleHistoryDialog';
export function RulesPage() {
  const rules = useRulesQuery(), { data: session } = useSessionQuery();
  const [toggle] = useToggleRuleMutation();
  const [edit, setEdit] = useState<Rule | 'new'>(), [history, setHistory] = useState<Rule>();
  const [conflict, setConflict] = useState(false), [error, setError] = useState('');
  const canEdit = session?.user.role === 'admin';
  const refresh = () => { setConflict(false); setEdit(undefined); void rules.refetch(); };
  const showConflict = () => { setEdit(undefined); setConflict(true); };
  const toggleEnabled = async (rule: Rule) => { setError(''); try { await toggle({ id: rule._id, version: rule.version, enabled: !rule.enabled }).unwrap(); } catch (cause) { if ((cause as ApiError).status === 409) showConflict(); else setError('Rule status could not be changed.'); } };
  if (rules.isLoading) return <><div className="page-heading"><div><h1>Rule configuration</h1></div></div><p className="loading-state">Loading monitoring rules…</p></>;
  if (rules.isError) return <><div className="page-heading"><div><h1>Rule configuration</h1></div></div><div className="error-state"><h2>Monitoring rules are unavailable</h2><button className="button" onClick={() => void rules.refetch()}>Retry</button></div></>;
  return <><div className="page-heading"><div><p className="eyebrow">Versioned monitoring policy</p><h1>Rule configuration</h1><p>Rules evaluate measured application metrics. Every change is audited.</p></div><button className="button primary" disabled={!canEdit} title={!canEdit ? 'Admin role is required to change rules.' : undefined} onClick={() => setEdit('new')}><Plus/>Create rule</button></div>
    {conflict && <div className="error-note" role="alert">This rule changed after you opened it. <button className="text-button" onClick={refresh}>Refresh current version</button></div>}{error && <div className="error-note" role="alert">{error}</div>}
    <section className="panel"><div className="table-scroll"><table className="rules-table"><thead><tr><th>Rule</th><th>Scope</th><th>Condition</th><th>Severity</th><th>Version</th><th>Enabled</th><th>Actions</th></tr></thead><tbody>{rules.data?.rules.map(rule => <tr key={rule._id}><td><strong>{rule.name}</strong></td><td>{rule.scope.kind === 'symbol' ? rule.scope.symbol : 'All symbols'}</td><td className="mono">{rule.metric} {rule.operator} {rule.threshold} / {rule.durationSeconds}s</td><td><StatusBadge value={rule.severity}/></td><td><button className="version-button" onClick={() => setHistory(rule)}><FileClock/>v{rule.version}</button></td><td><button className={`toggle ${rule.enabled ? 'on':''}`} role="switch" aria-checked={rule.enabled} disabled={!canEdit} title={!canEdit ? 'Admin role is required to change rules.' : undefined} onClick={() => void toggleEnabled(rule)}><span/></button></td><td><button className="button small-button" disabled={!canEdit} title={!canEdit ? 'Admin role is required to change rules.' : undefined} onClick={() => setEdit(rule)}>Edit</button></td></tr>)}</tbody></table>{rules.data && !rules.data.rules.length && <div className="empty-state"><h3>No monitoring rules</h3><p>An administrator can create the first rule.</p></div>}</div></section>
    {edit && <RuleDialog rule={edit === 'new' ? undefined : edit} onClose={() => setEdit(undefined)} onConflict={showConflict}/>} {history && <RuleHistoryDialog rule={history} onClose={() => setHistory(undefined)}/>}</>;
}
