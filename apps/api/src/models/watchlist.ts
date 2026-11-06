import mongoose from 'mongoose';
const { Schema, model, models } = mongoose;
export interface WatchlistDocument { symbol: string; enabled: boolean; createdAt: Date; updatedAt: Date }
const schema = new Schema<WatchlistDocument>({ symbol: { type: String, required: true, unique: true, uppercase: true, trim: true }, enabled: { type: Boolean, required: true, default: true } }, { timestamps: true });
export const Watchlist = models.Watchlist ?? model<WatchlistDocument>('Watchlist', schema);
export const DEFAULT_WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'TSLA', 'JPM', 'SPY'] as const;
export async function bootstrapDefaultWatchlist(repository: Pick<typeof Watchlist, 'countDocuments' | 'insertMany'> = Watchlist): Promise<void> {
  if (await repository.countDocuments({}) !== 0) return;
  await repository.insertMany(DEFAULT_WATCHLIST.map(symbol => ({ symbol, enabled: true })), { ordered: false });
}
