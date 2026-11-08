import type { BootstrapAttempt } from './bootstrap-attempt.js';
import type { SubscriptionCoordinator } from './monitoring/subscription-coordinator.js';
import { User } from './models/user.js';

export interface WatchlistMigrationSummary { initializedUsers: number; batches: number }

// Capture the initial upper ID lazily, after indexes are ready. Keyset pagination
// bounds memory and prevents concurrent user creation from extending this run.
// Each retry gets a fresh reader and resumes from persisted initialization markers.
export function createWatchlistInitializationReader(): PersonalWatchlistBootstrapDependencies['usersMissingInitialization'] {
  let captured = false;
  let upperId: string | undefined;
  return async (after, limit) => {
    if (!captured) {
      const lastUser = await User.findOne({ watchlistInitializedAt: null }).select('_id').sort({ _id: -1 }).lean();
      upperId = lastUser ? String(lastUser._id) : undefined;
      captured = true;
    }
    if (!upperId) return [];
    const users = await User.find({ watchlistInitializedAt: null, _id: { $lte: upperId, ...(after ? { $gt: after } : {}) } }).select('_id').sort({ _id: 1 }).limit(limit).lean();
    return users.map(user => String(user._id));
  };
}

interface PersonalWatchlistBootstrapDependencies {
  ensureIndexes(): Promise<void>;
  usersMissingInitialization(after: string | undefined, limit: number): Promise<string[]>;
  initializeUser(userId: string): Promise<void>;
  coordinator: SubscriptionCoordinator;
  provider: { connect(symbols: string[]): Promise<void>; disconnect(): Promise<void> };
  attempt: BootstrapAttempt;
  batchSize?: number;
  onMigrationComplete?(summary: WatchlistMigrationSummary): void;
}

export async function bootstrapPersonalWatchlists(dependencies: PersonalWatchlistBootstrapDependencies): Promise<void> {
  const batchSize = dependencies.batchSize ?? 100;
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) throw new Error('Invalid migration batch size');
  await dependencies.ensureIndexes();
  const summary: WatchlistMigrationSummary = { initializedUsers: 0, batches: 0 };
  let after: string | undefined;
  for (;;) {
    const users = await dependencies.usersMissingInitialization(after, batchSize);
    if (!users.length) break;
    for (const userId of users) await dependencies.initializeUser(userId);
    summary.initializedUsers += users.length;
    summary.batches += 1;
    after = users.at(-1);
  }
  dependencies.onMigrationComplete?.(summary);
  // Register before connecting, since a failed connect may already own a socket
  // or reconnect timer that must be removed before the next bootstrap attempt.
  await dependencies.coordinator.initialize(symbols => {
    dependencies.attempt.defer(() => dependencies.provider.disconnect());
    return dependencies.provider.connect(symbols);
  });
}
