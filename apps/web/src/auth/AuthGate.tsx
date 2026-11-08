import type { ReactNode } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../store';
import { useSessionQuery, useSetupStatusQuery } from '../api';
import { LoginPage } from './LoginPage';
import { SetupPage } from '../setup/SetupPage';
export function AuthGate({ children }: { children: ReactNode }) {
  const ended = useSelector((state: RootState) => state.auth.sessionEnded);
  const setup = useSetupStatusQuery(undefined, { skip: ended });
  const session = useSessionQuery(undefined, { skip: ended || !setup.data?.configured });
  if (ended) return <LoginPage />;
  if (setup.isLoading) return <main className="gate-page"><p>Checking services…</p></main>;
  if (setup.isError) return <main className="gate-page"><section className="gate-panel"><h1>Service status is unavailable</h1><p>The API did not respond. Confirm that it is running, then retry.</p><button className="button" onClick={() => void setup.refetch()}>Retry</button></section></main>;
  if (setup.data && !setup.data.configured) return <SetupPage status={setup.data} />;
  if (session.isLoading || session.isUninitialized) return <main className="gate-page"><p>Loading workspace…</p></main>;
  if (session.isError && (session.error as { status?: number }).status === 401) return <LoginPage />;
  if (session.isError) return <main className="gate-page"><section className="gate-panel"><h1>Session service is unavailable</h1><p>Your sign-in status could not be checked. Retry when the API is available.</p><button className="button" onClick={() => void session.refetch()}>Retry</button></section></main>;
  return <>{children}</>;
}
