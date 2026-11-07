import type { RuleInput } from '@marketpulse/contracts';
import mongoose from 'mongoose';
const { Schema, model, models } = mongoose;

export interface RuleDocument extends RuleInput { version: number; creatorId: string; createdAt: Date; updatedAt: Date }
const scope = new Schema({ kind: { type: String, enum: ['all', 'symbol'], required: true }, symbol: String }, { _id: false });
const schema = new Schema<RuleDocument>({
  name: { type: String, required: true, trim: true }, scope: { type: scope, required: true },
  metric: { type: String, enum: ['observedLatencyMs', 'messagesPerSecond', 'lastEventAgeSeconds', 'providerErrors', 'reconnects'], required: true },
  operator: { type: String, enum: ['gt', 'gte', 'lt', 'lte'], required: true }, threshold: { type: Number, required: true },
  durationSeconds: { type: Number, required: true }, severity: { type: String, enum: ['info', 'warning', 'critical'], required: true },
  enabled: { type: Boolean, required: true }, version: { type: Number, required: true, default: 1 }, creatorId: { type: String, required: true, immutable: true },
}, { timestamps: true });
export const Rule = models.Rule ?? model<RuleDocument>('Rule', schema);
