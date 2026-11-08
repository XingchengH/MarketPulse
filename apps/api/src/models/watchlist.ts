import mongoose from 'mongoose';
const { Schema, model, models } = mongoose;
/** @deprecated Legacy global collection shape, retained for compatibility and unused by production. Use UserWatchlistEntry instead. */
export interface WatchlistDocument { symbol: string; enabled: boolean; createdAt: Date; updatedAt: Date }
const schema = new Schema<WatchlistDocument>({ symbol: { type: String, required: true, unique: true, uppercase: true, trim: true }, enabled: { type: Boolean, required: true, default: true } }, { timestamps: true });
/**
 * @deprecated Compatibility model for the legacy global watchlists collection.
 * The collection is retained and unused by production; do not drop its data or
 * migration history. Personal watchlists use UserWatchlistEntry instead.
 */
export const Watchlist = models.Watchlist ?? model<WatchlistDocument>('Watchlist', schema);
/** @deprecated Legacy global defaults, retained for compatibility tests and unused by production. Use personal STARTER_SYMBOLS instead. */
export const DEFAULT_WATCHLIST = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'TSLA', 'JPM', 'SPY'] as const;
/** @deprecated Legacy global initializer, retained for compatibility tests and unused by production. Use PersonalWatchlistService.initializeUser instead. */
export async function bootstrapDefaultWatchlist(repository: Pick<typeof Watchlist, 'countDocuments' | 'insertMany'> = Watchlist): Promise<void> {
  if (await repository.countDocuments({}) !== 0) return;
  await repository.insertMany(DEFAULT_WATCHLIST.map(symbol => ({ symbol, enabled: true })), { ordered: false });
}
