import { Schema, model, models } from 'mongoose';

export interface RefreshTokenDocument {
  tokenHash: string;
  userId: Schema.Types.ObjectId;
  familyId: string;
  expiresAt: Date;
  purgeAt: Date;
  revokedAt?: Date;
  replacedByHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

const refreshTokenSchema = new Schema<RefreshTokenDocument>({
  tokenHash: { type: String, required: true, unique: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  familyId: { type: String, required: true, index: true },
  expiresAt: { type: Date, required: true, index: true },
  purgeAt: { type: Date, required: true, index: { expires: 0 } },
  revokedAt: { type: Date },
  replacedByHash: { type: String },
}, { timestamps: true });

export const RefreshToken = models.RefreshToken ?? model<RefreshTokenDocument>('RefreshToken', refreshTokenSchema);
