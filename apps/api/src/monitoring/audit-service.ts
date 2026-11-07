import { AuditEvent } from '../models/audit-event.js';
const forbidden = /secret|token|password|cookie|key/i;
export function redactAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuditValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !forbidden.test(key)).map(([key, child]) => [key, redactAuditValue(child)]));
  return value;
}
export interface AuditInput { actorId: string; action: string; resourceType: string; resourceId: string; requestId: string; before?: unknown; after?: unknown; createdAt?: Date }
export interface AuditStore { append(event: AuditInput): Promise<void> }
export class AuditService {
  constructor(private readonly store: AuditStore = { append: async event => { await AuditEvent.create(event); } }) {}
  record(event: AuditInput): Promise<void> { return this.store.append({ ...event, before: redactAuditValue(event.before), after: redactAuditValue(event.after), createdAt: event.createdAt ?? new Date() }); }
}
