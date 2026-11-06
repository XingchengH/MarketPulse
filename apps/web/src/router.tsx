import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { OverviewPage } from './dashboard/OverviewPage';
import { FeedsPage } from './dashboard/FeedsPage';
import { AlertsPage } from './alerts/AlertsPage';
import { RulesPage } from './rules/RulesPage';
import { AuditPage } from './audit/AuditPage';
const page = (node: React.ReactNode) => <AppShell>{node}</AppShell>;
export const router = createBrowserRouter([{ path: '/', element: page(<OverviewPage/>) }, { path: '/feeds', element: page(<><div className="page-heading"><div><p className="eyebrow">Live application data</p><h1>Live feeds</h1><p>Inspect per-symbol delivery health and observed metrics.</p></div></div><FeedsPage/></>) }, { path: '/alerts', element: page(<AlertsPage/>) }, { path: '/rules', element: page(<RulesPage/>) }, { path: '/audit', element: page(<AuditPage/>) }]);
