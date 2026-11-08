export type CleanupAction = () => void | Promise<void>;
export interface ExistingFailure { error: unknown }

/** Drain every resource, surfacing teardown failures without hiding the primary failure. */
export async function cleanupAll(
  actions: CleanupAction[],
  existingFailure?: ExistingFailure,
  report: (error: AggregateError) => void = error => console.error(error),
): Promise<void> {
  const failures: unknown[] = [];
  for (const stop of actions.splice(0).reverse()) {
    try { await stop(); }
    catch (error) { failures.push(error); }
  }
  if (failures.length === 0) return;
  const error = new AggregateError(failures, 'Verification cleanup failed', existingFailure ? { cause: existingFailure.error } : undefined);
  if (existingFailure) report(error);
  else throw error;
}
