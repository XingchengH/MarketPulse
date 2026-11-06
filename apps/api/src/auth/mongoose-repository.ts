import type { Role } from '@marketpulse/contracts';
import { RefreshToken } from '../models/refresh-token.js';
import { User } from '../models/user.js';
import { AuthInvariant } from '../models/auth-invariant.js';
import type { AdminUser, AdminUserRepository } from '../routes/admin-users.js';
import type { AuthRepository, PublicUser, RefreshRecord } from '../routes/auth.js';
import type { GoogleProfile } from './google-provider.js';

const publicUser = (value: { _id: unknown; email: string; name: string; picture?: string; role: Role; lastLoginAt?: Date }): PublicUser => ({
  id: String(value._id), email: value.email, name: value.name, picture: value.picture, role: value.role, lastLoginAt: value.lastLoginAt,
});
const adminUser = (value: { _id: unknown; email: string; name: string; role: Role; lastLoginAt?: Date }): AdminUser => ({ id: String(value._id), email: value.email, name: value.name, role: value.role, lastLoginAt: value.lastLoginAt });

export class MongooseAuthRepository implements AuthRepository, AdminUserRepository {
  async upsertGoogleUser(profile: GoogleProfile): Promise<PublicUser> {
    const user = await User.findOneAndUpdate(
      { googleSubject: profile.subject },
      { $set: { email: profile.email, name: profile.name, picture: profile.picture, lastLoginAt: new Date() }, $setOnInsert: { googleSubject: profile.subject, role: 'viewer' } },
      { upsert: true, returnDocument: 'after', runValidators: true },
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
    return { tokenHash: record.tokenHash, userId: String(record.userId), familyId: record.familyId, expiresAt: record.expiresAt, purgeAt: record.purgeAt, revokedAt: record.revokedAt, replacedByHash: record.replacedByHash };
  }
  async rotateRefresh(currentHash: string, replacement: RefreshRecord): Promise<boolean> {
    return RefreshToken.db.transaction(async (session) => {
      const updated = await RefreshToken.updateOne(
        { tokenHash: currentHash, revokedAt: { $exists: false } },
        { $set: { revokedAt: new Date(), replacedByHash: replacement.tokenHash } },
        { session },
      );
      if (updated.modifiedCount !== 1) return false;
      await RefreshToken.create([replacement], { session });
      return true;
    });
  }
  async revokeFamily(familyId: string): Promise<void> {
    await RefreshToken.updateMany({ familyId, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } });
  }
  async listUsers(): Promise<AdminUser[]> {
    const users = await User.find().select('email name role lastLoginAt').sort({ email: 1 }).lean();
    return users.map((user) => adminUser(user as never));
  }
  async setRoleSafely(id: string, role: Role): Promise<
    { status: 'updated'; user: AdminUser } | { status: 'not_found' } | { status: 'final_admin' }
  > {
    return User.db.transaction(async (session) => {
      // Every role mutation writes the same record, preventing snapshot-isolation write skew.
      await AuthInvariant.updateOne({ key: 'roles' }, { $inc: { revision: 1 } }, { upsert: true, session });
      const current = await User.findById(id).session(session).lean();
      if (!current) return { status: 'not_found' as const };
      if (current.role === 'admin' && role !== 'admin' && await User.countDocuments({ role: 'admin' }).session(session) <= 1) {
        return { status: 'final_admin' as const };
      }
      const user = await User.findByIdAndUpdate(id, { $set: { role } }, { returnDocument: 'after', runValidators: true, session }).lean();
      return { status: 'updated' as const, user: adminUser(user as never) };
    });
  }
}
