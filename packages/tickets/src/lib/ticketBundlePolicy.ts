/**
 * Pure, server-independent ticket-bundle policy primitives.
 *
 * Kept out of `actions/ticketBundleUtils.ts` because that module carries a
 * `'use server'` directive, which only permits async-function exports. The
 * attach engine and the read action import these; the unit test for the
 * choice resolution imports directly from here.
 */

export type ClosedMasterChoice = 'keep_closed' | 'apply_resolution' | 'reopen_master';

export const CLOSED_MASTER_CHOICES: readonly ClosedMasterChoice[] = [
  'keep_closed',
  'apply_resolution',
  'reopen_master',
];

/**
 * Which closed-master choices are legal for the master. An open master has no
 * applicable choice. A board that forbids open children under a closed master
 * drops `keep_closed`, leaving the two choices that resolve the inconsistency.
 */
export function resolveClosedMasterChoices(params: {
  isClosed: boolean;
  requireNoOpenChildren: boolean;
}): ClosedMasterChoice[] {
  if (!params.isClosed) return [];
  return params.requireNoOpenChildren
    ? ['apply_resolution', 'reopen_master']
    : ['keep_closed', 'apply_resolution', 'reopen_master'];
}

/**
 * Thrown when the guarded link UPDATE no longer matches every selected child.
 * Extends Error so it can cross the transaction boundary and be mapped to the
 * caller's conflict error; a `throw` (rather than a returned failure) is what
 * forces the partial link write to roll back.
 */
export class BundleConcurrentModificationError extends Error {
  constructor(
    message = 'One or more selected tickets were bundled concurrently. Please refresh and try again.'
  ) {
    super(message);
    this.name = 'BundleConcurrentModificationError';
  }
}
