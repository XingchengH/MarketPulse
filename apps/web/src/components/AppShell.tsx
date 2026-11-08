import { Activity, Bell, ChevronUp, FileClock, LayoutDashboard, LogOut, Menu, Moon, Radio, Settings, SlidersHorizontal, Sun, UserRound, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useDispatch } from 'react-redux';
import { NavLink, useLocation } from 'react-router-dom';
import { api, useAlertsQuery, useLogoutMutation, useSessionQuery, useSwitchAccountMutation, type User } from '../api';
import { sessionEnded } from '../auth/session';

const nav = [['/', 'Overview', LayoutDashboard], ['/feeds', 'Live feeds', Radio], ['/alerts', 'Alert center', Bell], ['/rules', 'Configuration', SlidersHorizontal], ['/audit', 'Audit trail', FileClock]] as const;
const navigateToGoogleDefault = (url: string) => window.location.assign(url);

function AccountMenu({ user, navigateToGoogle }: { user: User; navigateToGoogle: (url: string) => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const location = useLocation();
  const dispatch = useDispatch();
  const [logout] = useLogoutMutation();
  const [switchAccount] = useSwitchAccountMutation();

  useEffect(() => { setOpen(false); }, [location.pathname]);
  useLayoutEffect(() => {
    // Disabled actions cannot retain focus. Keep Escape and menu navigation
    // available during cleanup, including when the pending menu is reopened.
    if (open && (pending || error)) menu.current?.focus();
  }, [open, pending, error]);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  async function endSession(switching: boolean) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      await (switching ? switchAccount() : logout()).unwrap();
    } catch {
      busy.current = false;
      setPending(false);
      setError(`${switching ? 'Could not switch accounts.' : 'Could not sign out.'} Please try again.`);
      return;
    }
    dispatch(sessionEnded());
    dispatch(api.util.resetApiState());
    if (switching) navigateToGoogle('/api/auth/google?select_account=true');
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
      if (!items.length) return;
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  }

  return <div className="account-menu" ref={container} onBlur={event => {
    // Disabling the clicked action blurs it in Chromium; keep pending status
    // and any subsequent retry message visible. Outside clicks still dismiss.
    if (busy.current && event.relatedTarget === null) return;
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <button ref={trigger} className="profile profile-trigger" aria-label={`Account menu for ${user.name}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen(value => !value)} onKeyDown={event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); }
    }}>
      <span className="avatar" aria-hidden="true">{user.name.split(' ').map(part => part[0]).join('').slice(0, 2)}</span>
      <span className="profile-copy"><strong>{user.name}</strong><small>{user.role}</small></span><ChevronUp size={15} aria-hidden="true" />
    </button>
    {open && <div ref={menu} id={menuId} role="menu" tabIndex={-1} aria-label="Account actions" aria-busy={pending} className="profile-menu" onKeyDown={onKeyDown}>
      <div role="none" className="profile-details"><strong>{user.name}</strong><span>{user.email}</span><small>{user.role}</small></div>
      <button role="menuitem" disabled={pending} onClick={() => void endSession(true)}><UserRound size={16} aria-hidden="true" />Switch account</button>
      <button role="menuitem" disabled={pending} onClick={() => void endSession(false)}><LogOut size={16} aria-hidden="true" />Sign out</button>
      <p className="profile-menu-note">Signs you out of MarketPulse only.</p>
      {pending && <p role="status" className="profile-menu-note">Ending your session…</p>}
      {error && <p role="alert" className="profile-menu-error">{error}</p>}
    </div>}
  </div>;
}

export function AppShell({ children, navigateToGoogle = navigateToGoogleDefault }: { children: ReactNode; navigateToGoogle?: (url: string) => void }) {
  const [dark, setDark] = useState(false);
  const [open, setOpen] = useState(false);
  const { data: session } = useSessionQuery();
  const { data: alertData } = useAlertsQuery('open');
  const count = alertData?.alerts.length ?? 0;
  const links = session?.user.role === 'admin' ? [...nav, ['/admin', 'Administration', Settings] as const] : nav;
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, [dark]);
  return <div className="app-shell">
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="brand"><span className="brand-mark"><Activity /></span><span>Market<span className="brand-light">Pulse</span><small>Market data operations</small></span><button className="icon-button mobile-close" aria-label="Close navigation" onClick={() => setOpen(false)}><X /></button></div>
      <div className="nav-label">Workspace</div>
      <nav>{links.map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={() => setOpen(false)}><Icon size={18}/><span>{label}</span>{label === 'Alert center' && count > 0 && <span className="nav-badge">{count}</span>}</NavLink>)}</nav>
      <div className="sidebar-bottom">{session && <AccountMenu user={session.user} navigateToGoogle={navigateToGoogle} />}</div>
    </aside>
    <div className="workspace"><header className="topbar"><button className="icon-button mobile-menu" onClick={() => setOpen(true)} aria-label="Open navigation"><Menu /></button><span className="topbar-title">Operations workspace</span><div className="topbar-actions"><button className="icon-button" aria-label="Toggle theme" onClick={() => setDark(value => !value)}>{dark ? <Sun/> : <Moon/>}</button></div></header><main>{children}</main></div>
  </div>;
}
