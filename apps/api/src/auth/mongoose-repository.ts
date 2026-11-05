import type { Role } from '@marketpulse/contracts';
import { RefreshToken } from '../models/refresh-token.js';
import { User } from '../models/user.js';
import type { AdminUserRepository } from '../routes/admin-users.js';
import type { AuthRepository, PublicUser, RefreshRecord } from '../routes/auth.js';
import type { GoogleProfile } from './google-provider.js';

const publicUser = (value: { _id: unknown; email: string; name: string; picture?: string; role: Role }): PublicUser => ({
  id: String(value._id), email: value.email, name: value.name, picture: value.picture, role: value.role,
});

export class MongooseAuthRepository implements AuthRepository, AdminUserRepository {
  async upsertGoogleUser(profile: GoogleProfile): Promise<PublicUser> {
    const user = await User.findOneAndUpdate(
      { googleSubject: profile.subject },
      { $set: { email: profile.email, name: profile.name, picture: profile.picture }, $setOnInsert: { googleSubject: profile.subject, role: 'viewer' } },
      { upsert: true, new: true, runValidators: true },
    ).lean();
    return publicUser(user as never);
  }
  async findUserById(id: string): Promise<PublicUser | null> {
    const user = await User.findById(id).lean();
    return user ? publicUser(user as never) : null;
  }
  async saveRefresh(record: RefreshRecord): Promise<void> { await RefreshToken.create(record); }
  async findRefresh(tokenHash: string): Promise<RefreshRecord | null> {
    const record = await RefreshToken.findOne({ tokenHash }).lean();
    if (!record) return null;
    return { tokenHash: record.tokenHash, userId: String(record.userId), familyId: record.familyId, expiresAt: record.expiresAt, revokedAt: record.revokedAt, replacedByHash: record.replacedByHash };
  }
  async rotateRefresh(currentHash: string, replacement: RefreshRecord): Promise<boolean> {
    const updated = await RefreshToken.updateOne({ tokenHash: currentHash, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date(), replacedByHash: replacement.tokenHash } });
    if (updated.modifiedCount !== 1) return false;
    await RefreshToken.create(replacement);
    return true;
  }
  async revokeFamily(familyId: string): Promise<void> {
    await RefreshToken.updateMany({ familyId, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } });
  }
  async listUsers(): Promise<PublicUser[]> {
    const users = await User.find().sort({ email: 1 }).lean();
    return users.map((user) => publicUser(user as never));
  }
  async countAdmins(): Promise<number> { return User.countDocuments({ role: 'admin' }); }
  async setRole(id: string, role: Role): Promise<PublicUser | null> {
    const user = await User.findByIdAndUpdate(id, { $set: { role } }, { new: true, runValidators: true }).lean();
    return user ? publicUser(user as never) : null;
  }
}
