import type { Role } from '@marketpulse/contracts';
import { Schema, model, models } from 'mongoose';

export interface UserDocument {
  googleSubject: string;
  email: string;
  name: string;
  picture?: string;
  role: Role;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDocument>({
  googleSubject: { type: String, required: true, unique: true, immutable: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  name: { type: String, required: true, trim: true },
  picture: { type: String },
  role: { type: String, enum: ['viewer', 'operator', 'admin'], default: 'viewer', required: true },
}, { timestamps: true });

export const User = models.User ?? model<UserDocument>('User', userSchema);
