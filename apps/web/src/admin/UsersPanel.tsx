import { useState } from 'react';
import type { Role } from '@marketpulse/contracts';
import { useUpdateUserRoleMutation, useUsersQuery, type ApiError, type User } from '../api';
import { Modal } from '../components/Modal';

export function UsersPanel() {
  const { data, isLoading, isError, refetch } = useUsersQuery();
  const [update, state] = useUpdateUserRoleMutation();
  const [pending, setPending] = useState<{ user: User; role: Role }>();
  const [feedback, setFeedback] = useState('');
  const confirm = async () => {
    if (!pending) return;
    try { await update({ id: pending.user.id, role: pending.role }).unwrap(); setFeedback(`${pending.user.name} is now ${pending.role}`); setPending(undefined); }
    catch (error) { setFeedback((error as ApiError)?.data?.error?.message ?? 'Unable to change role'); }
  };
  return <section className="panel admin-panel" aria-labelledby="users-title"><div className="panel-heading"><div><h2 id="users-title">Users</h2><p>Manage workspace access without exposing identity provider credentials.</p></div></div><p role="status" aria-live="polite">{feedback}</p>{isLoading && <p>Loading users…</p>}{isError && <div className="error-state"><h3>Users are unavailable</h3><button className="secondary-button" onClick={() => void refetch()}>Retry users</button></div>}{data && <table><thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Last login</th></tr></thead><tbody>{data.users.map(user => <tr key={user.id}><td>{user.name}</td><td>{user.email}</td><td><label className="sr-only" htmlFor={`role-${user.id}`}>Role for {user.name}</label><select id={`role-${user.id}`} value={user.role} onChange={event => setPending({ user, role: event.target.value as Role })}><option value="viewer">Viewer</option><option value="operator">Operator</option><option value="admin">Admin</option></select></td><td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never'}</td></tr>)}</tbody></table>}{pending && <Modal title="Confirm role change" onClose={() => setPending(undefined)}><p>Change <strong>{pending.user.name}</strong> to <strong>{pending.role}</strong>?</p><div className="dialog-actions"><button className="secondary-button" onClick={() => setPending(undefined)}>Cancel</button><button className="primary-button" disabled={state.isLoading} onClick={() => void confirm()}>Confirm role change</button></div></Modal>}</section>;
}
