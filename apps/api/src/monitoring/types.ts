import type { RuleInput, RuleMetric } from '@marketpulse/contracts';
export interface RuntimeRule extends RuleInput { id: string; version: number; creatorId: string }
export type MetricValues = Partial<Record<RuleMetric, number>>;
