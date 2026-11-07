import mongoose from 'mongoose';
const { Schema, model, models } = mongoose;
export interface AuditEventDocument { actorId: string; action: string; resourceType: string; resourceId: string; requestId: string; before?: unknown; after?: unknown; createdAt: Date }
const schema = new Schema<AuditEventDocument>({ actorId: { type: String, required: true, immutable: true }, action: { type: String, required: true, immutable: true }, resourceType: { type: String, required: true, immutable: true }, resourceId: { type: String, required: true, immutable: true }, requestId: { type: String, required: true, immutable: true }, before: { type: Schema.Types.Mixed, immutable: true }, after: { type: Schema.Types.Mixed, immutable: true } }, { timestamps: { createdAt: true, updatedAt: false } });
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) schema.pre(operation, () => { throw new Error('Audit events are append-only'); });
export const AuditEvent = models.AuditEvent ?? model<AuditEventDocument>('AuditEvent', schema);
