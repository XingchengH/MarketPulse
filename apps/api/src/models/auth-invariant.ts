import { Schema, model, models } from 'mongoose';

interface AuthInvariantDocument { key: string; revision: number }

const authInvariantSchema = new Schema<AuthInvariantDocument>({
  key: { type: String, required: true, unique: true },
  revision: { type: Number, required: true, default: 0 },
});

export const AuthInvariant = models.AuthInvariant ?? model<AuthInvariantDocument>('AuthInvariant', authInvariantSchema);
