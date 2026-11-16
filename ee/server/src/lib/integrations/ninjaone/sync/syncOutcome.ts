/**
 * Shared outcome vocabulary for the whole-fleet NinjaOne inventory syncs
 * (software + patches), so both report partial results the same way.
 */

/**
 * `succeeded` — ran to completion, no device failed
 * `partial`   — ran to completion, at least one device failed
 * `failed`    — threw, or the integration became unusable mid-run
 */
export type SyncRunStatus = 'succeeded' | 'partial' | 'failed';

/** Cap on stored error messages; a bad fleet must not write megabytes into settings. */
export const MAX_SYNC_ERRORS = 20;

export interface SyncErrorBag {
  errors: string[];
  errorCount: number;
}

/** Counts every error but keeps only the first MAX_SYNC_ERRORS messages. */
export function recordSyncError(bag: SyncErrorBag, message: string): void {
  bag.errorCount++;
  if (bag.errors.length < MAX_SYNC_ERRORS) {
    bag.errors.push(message);
  }
}

export function statusForCompletedRun(assetsFailed: number): SyncRunStatus {
  return assetsFailed === 0 ? 'succeeded' : 'partial';
}

/** Progress is bookkeeping: a throwing callback must never fail the sync. */
export function reportProgress(
  onProgress: ((done: number, total: number) => void) | undefined,
  done: number,
  total: number,
): void {
  try {
    onProgress?.(done, total);
  } catch {
    // ignored on purpose
  }
}
