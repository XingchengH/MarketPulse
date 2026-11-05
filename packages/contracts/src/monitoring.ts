import { z } from 'zod';

export const metricSchema = z.enum([
  'observedLatencyMs',
  'messagesPerSecond',
  'lastEventAgeSeconds',
  'providerErrors',
  'reconnects',
]);
export const operatorSchema = z.enum(['gt', 'gte', 'lt', 'lte']);
export const alertStatusSchema = z.enum(['open', 'recovered', 'acknowledged']);

const ruleScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('symbol'), symbol: z.string().regex(/^[A-Z][A-Z0-9.-]*$/) }),
  z.object({ kind: z.literal('provider'), provider: z.string().min(1) }),
]);

export const ruleInputSchema = z.object({
  name: z.string().min(1),
  scope: ruleScopeSchema,
  metric: metricSchema,
  operator: operatorSchema,
  threshold: z.number().finite().nonnegative(),
  durationSeconds: z.number().finite().positive(),
  severity: z.enum(['info', 'warning', 'critical']),
  enabled: z.boolean(),
});

export type Metric = z.infer<typeof metricSchema>;
export type Operator = z.infer<typeof operatorSchema>;
export type AlertStatus = z.infer<typeof alertStatusSchema>;
export type RuleInput = z.infer<typeof ruleInputSchema>;
