import mongoose, { type Model, type Types } from 'mongoose';
const { Schema, model, models } = mongoose;

export interface UserWatchlistEntryDocument {
  userId: Types.ObjectId;
  symbol: string;
  companyName: string;
  exchange?: string;
  assetClass: 'us_equity';
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<UserWatchlistEntryDocument>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  symbol: { type: String, required: true, uppercase: true, trim: true },
  companyName: { type: String, required: true, trim: true },
  exchange: { type: String, trim: true },
  assetClass: { type: String, enum: ['us_equity'], required: true },
}, { timestamps: true });
schema.index({ userId: 1, symbol: 1 }, { unique: true });
schema.index({ symbol: 1, userId: 1 });

export const UserWatchlistEntry = (models.UserWatchlistEntry as Model<UserWatchlistEntryDocument> | undefined)
  ?? model<UserWatchlistEntryDocument>('UserWatchlistEntry', schema);
