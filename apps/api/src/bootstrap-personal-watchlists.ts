import type { BootstrapAttempt } from './bootstrap-attempt.js';
import type { SubscriptionCoordinator } from './monitoring/subscription-coordinator.js';

interface PersonalWatchlistBootstrapDependencies {
  ensureIndexes(): Promise<void>;
  usersMissingInitialization(after: string | undefined, limit: number): Promise<string[]>;
  initializeUser(userId: string): Promise<void>;
  coordinator: SubscriptionCoordinator;
  provider: { connect(symbols: string[]): Promise<void>; disconnect(): Promise<void> };
  attempt: BootstrapAttempt;
  batchSize?: number;
}

export async function bootstrapPersonalWatchlists(dependencies: PersonalWatchlistBootstrapDependencies): Promise<void> {
  await dependencies.ensureIndexes();
  let after: string | undefined;
  for (;;) {
    const users = await dependencies.usersMissingInitialization(after, dependencies.batchSize ?? 100);
    if (!users.length) break;
    for (const userId of users) await dependencies.initializeUser(userId);
    after = users.at(-1);
  }
  // Register before connecting, since a failed connect may already own a socket
  // or reconnect timer that must be removed before the next bootstrap attempt.
  await dependencies.coordinator.initialize(symbols => {
    dependencies.attempt.defer(() => dependencies.provider.disconnect());
    return dependencies.provider.connect(symbols);
  });
}
