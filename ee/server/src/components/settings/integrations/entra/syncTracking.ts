/**
 * Following a sync from "accepted" to a terminal status.
 *
 * Temporal accepting the workflow proves nothing about it running. Until a
 * worker picks it up there is no entra_sync_runs row, so the detail lookup
 * answers "not found", which is normal for the first few seconds and a
 * symptom after that: a worker that has died inside a still-healthy pod
 * (issue #3408) leaves the run queued indefinitely. After a short streak of
 * "not found" this asks whether anything polls the queue at all, and stops
 * with a specific error when nothing does, instead of polling for half an
 * hour and then blaming the page.
 */

export const SYNC_STATUS_POLL_INTERVAL_MS = 2_000;
export const SYNC_STATUS_POLL_ATTEMPTS = 900;
/** Consecutive "not found" answers between worker checks: 30s at the default interval. */
export const SYNC_WORKER_CHECK_EVERY_NOT_FOUND = 15;
/** Consecutive "not found" answers before giving up on a run that never began: 5 minutes. */
export const SYNC_NOT_FOUND_GIVE_UP = 150;
export const TERMINAL_SYNC_STATUSES: ReadonlySet<string> = new Set(['completed', 'partial', 'failed']);

export class EntraSyncWorkerUnavailableError extends Error {
  constructor() {
    super('No worker is polling the Entra sync queue; the sync is accepted but cannot start.');
    this.name = 'EntraSyncWorkerUnavailableError';
  }
}

export interface SyncRunDetailEnvelope {
  error?: string;
  data?: { run?: { status?: string | null } | null } | null;
}

export interface SyncWorkerAvailabilityEnvelope {
  error?: string;
  data?: { workerEvidence?: string | null } | null;
}

export interface SyncTrackingDeps {
  getRunDetail: (runReference: string) => Promise<SyncRunDetailEnvelope>;
  getWorkerAvailability: () => Promise<SyncWorkerAvailabilityEnvelope>;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function waitForEntraSyncTerminal(
  runReference: string,
  deps: SyncTrackingDeps
): Promise<string> {
  const sleep = deps.sleep ?? defaultSleep;
  let notFoundStreak = 0;

  for (let attempt = 0; attempt < SYNC_STATUS_POLL_ATTEMPTS; attempt += 1) {
    const result = await deps.getRunDetail(runReference);
    const error = 'error' in result ? result.error : undefined;

    if (error === undefined) {
      notFoundStreak = 0;
      const status = String(result.data?.run?.status || '').toLowerCase();
      if (TERMINAL_SYNC_STATUSES.has(status)) {
        return status;
      }
    } else if (/not found/i.test(error)) {
      notFoundStreak += 1;
      if (notFoundStreak % SYNC_WORKER_CHECK_EVERY_NOT_FOUND === 0) {
        const availability = await deps.getWorkerAvailability();
        const evidence = 'error' in availability && availability.error ? null : availability.data?.workerEvidence;
        if (evidence === 'none') {
          throw new EntraSyncWorkerUnavailableError();
        }
      }
      if (notFoundStreak >= SYNC_NOT_FOUND_GIVE_UP) {
        throw new Error('The Entra sync was accepted but never started.');
      }
    } else {
      throw new Error(error || 'Entra sync status could not be loaded.');
    }

    if (attempt < SYNC_STATUS_POLL_ATTEMPTS - 1) {
      await sleep(SYNC_STATUS_POLL_INTERVAL_MS);
    }
  }

  throw new Error('Timed out waiting for the Entra sync to finish.');
}
