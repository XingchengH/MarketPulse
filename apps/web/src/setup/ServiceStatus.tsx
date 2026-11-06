import type { SetupStatus } from '../api';
import { StatusBadge } from '../components/StatusBadge';
const labels = { mongodb: 'MongoDB', googleOAuth: 'Google OAuth', alpaca: 'Alpaca market data', tokens: 'Session tokens' };
export function ServiceStatus({ status }: { status: SetupStatus }) {
  return <dl className="service-list">{Object.entries(status.services).map(([key, value]) => <div key={key}><dt>{labels[key as keyof typeof labels]}</dt><dd><StatusBadge value={value} /></dd></div>)}</dl>;
}
