import { Schema, model, models } from 'mongoose';
export interface WatchlistDocument { symbol: string; enabled: boolean; createdAt: Date; updatedAt: Date }
const schema = new Schema<WatchlistDocument>({ symbol: { type: String, required: true, unique: true, uppercase: true, trim: true }, enabled: { type: Boolean, required: true, default: true } }, { timestamps: true });
export const Watchlist = models.Watchlist ?? model<WatchlistDocument>('Watchlist', schema);
