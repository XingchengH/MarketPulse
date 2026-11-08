import { UsersPanel } from './UsersPanel';
export function AdminPage() { return <><div className="page-heading"><div><p className="eyebrow">Restricted workspace</p><h1>Administration</h1><p>Manage user access.</p></div></div><div className="admin-grid"><UsersPanel/></div></>; }
