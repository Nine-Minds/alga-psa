/**
 * IMAP incremental-sync cursor semantics, shared by the standalone
 * email-service listener loop.
 *
 * The auth-pause recovery path (EmailProviderLifecycleService) arms
 * `last_uid = '0'` after credentials re-validate; this module defines what
 * each cursor shape means when the listener resolves its next scan start.
 */

/**
 * Resolve the first UID an incremental sync should scan from.
 *
 * - a truthy `lastUid` resumes from `Number(lastUid) + 1` — including the
 *   explicit `'0'` marker (auth-pause recovery resync contract), which scans
 *   from UID 1 so the WHOLE paused interval is covered; dedupe suppresses
 *   already-processed mail;
 * - a missing cursor (initial connect) starts from the most recent window
 *   (`uidNext - maxEmailsPerSync`) instead of replaying the entire mailbox
 *   from UID 1.
 */
export function resolveImapSyncStartUid(
  lastUid: string | undefined,
  uidNext: number | undefined,
  maxEmailsPerSync: number
): number {
  if (lastUid) {
    return Number(lastUid) + 1;
  }
  if (uidNext && Number(uidNext) > 1) {
    return Math.max(1, Number(uidNext) - maxEmailsPerSync);
  }
  return 1;
}
