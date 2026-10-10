/**
 * One-time cleanup of the retired browser-side ticket timer store (plan D16).
 *
 * Before the server-side stopwatch, ticket intervals were kept in the IndexedDB database
 * `TicketTimeTrackingDB`. They are dropped rather than imported: most came from auto-start
 * and record reading, not work, and the work trail covers the same days.
 *
 * REMOVE AFTER 2027-04-10 (about six months after release): by then every active browser has
 * run this once. Delete this file and its call in StopwatchProvider.
 */

export const LEGACY_TICKET_TIMER_DB_NAME = 'TicketTimeTrackingDB';
export const LEGACY_PURGE_FLAG_KEY = 'alga-legacy-ticket-timer-store-purged';

/**
 * Deletes the legacy IndexedDB database at most once per browser. Client-only and SSR-safe:
 * a no-op where `indexedDB` or `localStorage` is unavailable. Never throws.
 */
export function purgeLegacyTicketTimerStore(): void {
  try {
    if (typeof indexedDB === 'undefined' || typeof localStorage === 'undefined') return;
    if (localStorage.getItem(LEGACY_PURGE_FLAG_KEY)) return;

    const request = indexedDB.deleteDatabase(LEGACY_TICKET_TIMER_DB_NAME);
    const markDone = () => {
      try {
        localStorage.setItem(LEGACY_PURGE_FLAG_KEY, '1');
      } catch {
        // Storage unavailable: the delete is idempotent, so retrying next load is harmless.
      }
    };
    request.onsuccess = markDone;
    // Blocked means another tab still holds a connection; the delete completes when it closes.
    request.onblocked = markDone;
    // On error leave the flag unset and retry on the next load.
  } catch {
    // Best-effort cleanup; never affect the stopwatch.
  }
}
