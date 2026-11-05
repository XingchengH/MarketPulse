import type { RuleInput } from '@marketpulse/contracts';
import { Schema, model, models } from 'mongoose';
export interface RuleVersionDocument { ruleId: string; version: number; snapshot: RuleInput; actorId: string; createdAt: Date }
const schema = new Schema<RuleVersionDocument>({ ruleId: { type: String, required: true, immutable: true }, version: { type: Number, required: true, immutable: true }, snapshot: { type: Schema.Types.Mixed, required: true, immutable: true }, actorId: { type: String, required: true, immutable: true } }, { timestamps: { createdAt: true, updatedAt: false } });
schema.index({ ruleId: 1, version: 1 }, { unique: true });
export const RuleVersion = models.RuleVersion ?? model<RuleVersionDocument>('RuleVersion', schema);
