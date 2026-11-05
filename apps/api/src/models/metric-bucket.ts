import { Schema, model, models } from 'mongoose';
export interface MetricBucketDocument { symbol: string; bucketStart: Date; messageCount: number; receivedMessagesPerSecond: number; latencyLatest: number; latencyP95: number; staleDurationMs: number; latestTrade?: { price: number; size: number }; latestQuote?: { bid: number; ask: number }; spread?: number; providerErrors: number; reconnects: number }
const schema = new Schema<MetricBucketDocument>({ symbol: { type: String, required: true, uppercase: true }, bucketStart: { type: Date, required: true }, messageCount: { type: Number, required: true }, receivedMessagesPerSecond: { type: Number, required: true }, latencyLatest: { type: Number, required: true }, latencyP95: { type: Number, required: true }, staleDurationMs: { type: Number, required: true }, latestTrade: { price: Number, size: Number }, latestQuote: { bid: Number, ask: Number }, spread: Number, providerErrors: { type: Number, required: true, default: 0 }, reconnects: { type: Number, required: true, default: 0 } });
schema.index({ symbol: 1, bucketStart: 1 }, { unique: true });
export const MetricBucket = models.MetricBucket ?? model<MetricBucketDocument>('MetricBucket', schema);

export async function upsertMinuteBucket(bucket: MetricBucketDocument): Promise<void> {
  await MetricBucket.updateOne({ symbol: bucket.symbol, bucketStart: bucket.bucketStart }, { $set: bucket }, { upsert: true });
}
