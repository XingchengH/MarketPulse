import { z } from 'zod';

export const ruleMetricSchema = z.enum([
  'observedLatencyMs',
  'messagesPerSecond',
  'lastEventAgeSeconds',
  'providerErrors',
  'reconnects',
]);
export const ruleOperatorSchema = z.enum(['gt', 'gte', 'lt', 'lte']);
export const alertStatusSchema = z.enum(['open', 'recovered', 'acknowledged']);

const ruleScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('symbol'), symbol: z.string().regex(/^[A-Z][A-Z0-9.-]*$/) }),
  z.object({ kind: z.literal('provider'), provider: z.string().min(1) }),
]);

export const ruleInputSchema = z.object({
  name: z.string().min(1),
  scope: ruleScopeSchema,
  metric: ruleMetricSchema,
  operator: ruleOperatorSchema,
  threshold: z.number().finite().nonnegative(),
  durationSeconds: z.number().finite().positive(),
  severity: z.enum(['info', 'warning', 'critical']),
  enabled: z.boolean(),
});

export type RuleMetric = z.infer<typeof ruleMetricSchema>;
export type RuleOperator = z.infer<typeof ruleOperatorSchema>;
export type AlertStatus = z.infer<typeof alertStatusSchema>;
export type RuleInput = z.infer<typeof ruleInputSchema>;
