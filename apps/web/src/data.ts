export type Health = 'Healthy' | 'Degraded' | 'Critical';
export type Region = 'Americas' | 'EMEA' | 'APAC';
export type Role = 'Viewer' | 'Operator' | 'Admin';
export type View = 'Overview' | 'Live feeds' | 'Alert center' | 'Configuration' | 'Audit trail';
export interface Feed { id: string; name: string; code: string; city: string; region: Region; status: Health; throughput: number; latency: number; loss: number; color: string; }
export interface Incident { id: string; feed: string; severity: 'Critical' | 'Warning'; title: string; detail: string; time: string; acknowledged: boolean; }
export interface Rule { id: string; name: string; feed: string; metric: string; operator: '>' | '<'; threshold: number; severity: 'Critical' | 'Warning'; enabled: boolean; version: number; previous?: Omit<Rule, 'previous'>; }
export interface Audit { id: string; action: string; subject: string; user: string; time: string; before: string; after: string; }

export const feeds: Feed[] = [
  { id: 'nyse', code: 'XNYS', name: 'New York Stock Exchange', city: 'New York', region: 'Americas', status: 'Healthy', throughput: 482.6, latency: 12.4, loss: 0.001, color: '#32748a' },
  { id: 'nasdaq', code: 'XNAS', name: 'NASDAQ', city: 'New York', region: 'Americas', status: 'Healthy', throughput: 624.8, latency: 8.2, loss: 0.002, color: '#547999' },
  { id: 'lse', code: 'XLON', name: 'London Stock Exchange', city: 'London', region: 'EMEA', status: 'Degraded', throughput: 318.2, latency: 58.2, loss: 0.014, color: '#7c6a93' },
  { id: 'tse', code: 'XTKS', name: 'Tokyo Stock Exchange', city: 'Tokyo', region: 'APAC', status: 'Healthy', throughput: 286.4, latency: 18.6, loss: 0.003, color: '#a36c6b' },
  { id: 'hkex', code: 'XHKG', name: 'Hong Kong Exchanges', city: 'Hong Kong', region: 'APAC', status: 'Degraded', throughput: 194.2, latency: 42.1, loss: 0.032, color: '#ab7b45' },
  { id: 'nse', code: 'XNSE', name: 'National Stock Exchange', city: 'Mumbai', region: 'APAC', status: 'Critical', throughput: 152.8, latency: 126.4, loss: 0.082, color: '#778a5f' },
  { id: 'cme', code: 'XCME', name: 'CME Group', city: 'Chicago', region: 'Americas', status: 'Healthy', throughput: 228.3, latency: 11.8, loss: 0.001, color: '#527e8b' },
  { id: 'euronext', code: 'XPAR', name: 'Euronext Paris', city: 'Paris', region: 'EMEA', status: 'Healthy', throughput: 168.4, latency: 16.2, loss: 0.004, color: '#7476a0' },
  { id: 'xetra', code: 'XETR', name: 'Deutsche Börse Xetra', city: 'Frankfurt', region: 'EMEA', status: 'Healthy', throughput: 144.2, latency: 14.6, loss: 0.002, color: '#657b95' },
  { id: 'asx', code: 'XASX', name: 'Australian Securities Exchange', city: 'Sydney', region: 'APAC', status: 'Healthy', throughput: 96.4, latency: 22.4, loss: 0.005, color: '#657f72' },
  { id: 'tsx', code: 'XTSE', name: 'Toronto Stock Exchange', city: 'Toronto', region: 'Americas', status: 'Healthy', throughput: 118.6, latency: 15.2, loss: 0.002, color: '#9d6f72' },
  { id: 'sgx', code: 'XSES', name: 'Singapore Exchange', city: 'Singapore', region: 'APAC', status: 'Healthy', throughput: 74.2, latency: 19.8, loss: 0.003, color: '#9e825a' },
];
export const initialIncidents: Incident[] = [
  { id: 'ALT-2041', feed: 'nse', severity: 'Critical', title: 'Latency threshold exceeded', detail: 'NSE · 126.4 ms / 100 ms threshold', time: '14:31:48', acknowledged: false },
  { id: 'ALT-2040', feed: 'lse', severity: 'Warning', title: 'Elevated feed latency', detail: 'LSE · 58.2 ms / 50 ms threshold', time: '14:29:12', acknowledged: false },
  { id: 'ALT-2039', feed: 'hkex', severity: 'Warning', title: 'Packet loss detected', detail: 'HKEX · 0.032% / 0.02% threshold', time: '14:27:06', acknowledged: false },
];
export const initialRules: Rule[] = [
  { id: 'RUL-001', name: 'Critical feed latency', feed: 'All exchanges', metric: 'Latency (ms)', operator: '>', threshold: 100, severity: 'Critical', enabled: true, version: 3, previous: { id: 'RUL-001', name: 'Critical feed latency', feed: 'All exchanges', metric: 'Latency (ms)', operator: '>', threshold: 120, severity: 'Critical', enabled: true, version: 2 } },
  { id: 'RUL-002', name: 'London latency warning', feed: 'lse', metric: 'Latency (ms)', operator: '>', threshold: 50, severity: 'Warning', enabled: true, version: 1 },
  { id: 'RUL-003', name: 'Packet loss monitor', feed: 'All exchanges', metric: 'Packet loss (%)', operator: '>', threshold: 0.02, severity: 'Warning', enabled: true, version: 2 },
  { id: 'RUL-004', name: 'Low throughput detection', feed: 'nasdaq', metric: 'Throughput (K msg/s)', operator: '<', threshold: 200, severity: 'Warning', enabled: false, version: 1 },
];
export const initialAudit: Audit[] = [
  { id: 'AUD-1003', action: 'Rule updated', subject: 'Critical feed latency', user: 'Alex Morgan', time: '14:26:32', before: 'Latency > 120 ms · v2', after: 'Latency > 100 ms · v3' },
  { id: 'AUD-1002', action: 'Alert acknowledged', subject: 'NASDAQ throughput recovery', user: 'Jamie Chen', time: '14:18:09', before: 'Open', after: 'Acknowledged' },
  { id: 'AUD-1001', action: 'Rule disabled', subject: 'Low throughput detection', user: 'Alex Morgan', time: '13:52:14', before: 'Enabled', after: 'Disabled' },
];
export function wave(seed: number, length = 60, scale = 1) {
  return Array.from({ length }, (_, i) => scale * (0.72 + Math.sin(i * 0.23 + seed) * 0.1 + Math.sin(i * 1.7 + seed * 2) * 0.065 + Math.cos(i * 0.67 + seed) * 0.07 + (i / length) * 0.14));
}
export function formatRate(value: number) { return value >= 1000 ? `${(value / 1000).toFixed(2)}M` : `${value.toFixed(1)}K`; }
export function ruleDescription(rule: Rule) { return `${rule.metric} ${rule.operator} ${rule.threshold} · ${rule.severity} · ${rule.enabled ? 'Enabled' : 'Disabled'}`; }
