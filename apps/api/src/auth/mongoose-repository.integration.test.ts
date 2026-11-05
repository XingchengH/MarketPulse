import { execFileSync } from 'node:child_process';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthInvariant } from '../models/auth-invariant.js';
import { RefreshToken } from '../models/refresh-token.js';
import { User } from '../models/user.js';
import type { RefreshRecord } from '../routes/auth.js';
import { MongooseAuthRepository } from './mongoose-repository.js';

describe('Mongoose auth transaction invariants', () => {
  let replicaSet: MongoMemoryReplSet;
  const repository = new MongooseAuthRepository();

  beforeAll(async () => {
    let systemBinary: string | undefined;
    try { systemBinary = execFileSync('which', ['mongod'], { encoding: 'utf8' }).trim() || undefined; } catch { /* runtime download fallback */ }
    replicaSet = await MongoMemoryReplSet.create({
      binary: systemBinary ? { systemBinary } : undefined,
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    await mongoose.connect(replicaSet.getUri(), { dbName: 'auth-transactions' });
    await Promise.all([User.syncIndexes(), RefreshToken.syncIndexes(), AuthInvariant.syncIndexes()]);
  }, 60_000);

  beforeEach(async () => {
    await Promise.all([User.deleteMany({}), RefreshToken.deleteMany({}), AuthInvariant.deleteMany({})]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replicaSet?.stop();
  });

  it('retries simultaneous refresh consumption and leaves no live successor after compromise', async () => {
    const userId = new Types.ObjectId();
    const purgeAt = new Date(Date.now() + 60_000);
    await RefreshToken.create({ tokenHash: 'original', userId, familyId: 'family', expiresAt: new Date(Date.now() + 30_000), purgeAt });
    const replacement = (tokenHash: string): RefreshRecord => ({
      tokenHash, userId: String(userId), familyId: 'family', expiresAt: new Date(Date.now() + 30_000), purgeAt,
    });

    const outcomes = await Promise.all(['next-a', 'next-b'].map(async (hash) => {
      const rotated = await repository.rotateRefresh('original', replacement(hash));
      if (!rotated) await repository.revokeFamily('family');
      return rotated;
    }));

    expect(outcomes.sort()).toEqual([false, true]);
    expect(await RefreshToken.countDocuments({ familyId: 'family', revokedAt: { $exists: false } })).toBe(0);
  });

  it('initializes the invariant row and preserves one admin during simultaneous demotions', async () => {
    const [first, second] = await User.create([
      { googleSubject: 'g-1', email: 'one@example.com', name: 'One', role: 'admin' },
      { googleSubject: 'g-2', email: 'two@example.com', name: 'Two', role: 'admin' },
    ]);
    expect(await AuthInvariant.countDocuments()).toBe(0);

    const outcomes = await Promise.all([
      repository.setRoleSafely(String(first._id), 'viewer'),
      repository.setRoleSafely(String(second._id), 'viewer'),
    ]);

    expect(outcomes.map((result) => result.status).sort()).toEqual(['final_admin', 'updated']);
    expect(await AuthInvariant.countDocuments({ key: 'roles' })).toBe(1);
    expect(await User.countDocuments({ role: 'admin' })).toBe(1);
  });
});
