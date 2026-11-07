import { describe, expect, it } from 'vitest';
import { AuditService, redactAuditValue } from './audit-service.js';

describe('audit redaction', () => {
  it('recursively rejects sensitive keys', async () => {
    expect(redactAuditValue({ name: 'ok', accessToken: 'bad', nested: { password: 'bad', value: 2 } })).toEqual({ name: 'ok', nested: { value: 2 } });
    const saved: unknown[] = [];
    const audit = new AuditService({ append: async event => { saved.push(event); } });
    await audit.record({ actorId: 'u', action: 'update', resourceType: 'rule', resourceId: 'r', requestId: 'req', before: { cookie: 'x' }, after: { enabled: true } });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ before: {}, after: { enabled: true } });
  });
});
