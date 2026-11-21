import type { Knex } from 'knex';
import { RequestLocalAuthorizationCache } from '@alga-psa/authorization/kernel';
import { resolveTimeEntryMode } from './timeEntryMode';

/**
 * Principal-decided limits on a seat technician's time (S28 / F070). Enforced in the server actions, so hiding a
 * button is never the only thing between a seat technician and someone else's entry.
 *
 * - A seat technician may read, edit and delete only their OWN OPERATIONAL entries: an entry that belongs to
 *   someone else, or a commercial one, reads as refused, whatever delegation or RBAC would otherwise allow.
 * - Timesheet submission (and the approval views it feeds) does not exist for them: operational time is never
 *   submitted or approved.
 *
 * Everyone who is not a seat technician is untouched. The principal is resolved by `resolveTimeEntryMode`, the same
 * single decision the write path uses, which costs a tenant with no seat technician no extra statement.
 * Not flag-gated: a data-correctness / authorization guard; the seat principal fails closed.
 */
export class SeatTimeAccessError extends Error {
  constructor(readonly code: 'SEAT_ENTRY_NOT_OWN_OPERATIONAL' | 'SEAT_TIMESHEET_SUBMISSION_UNAVAILABLE') {
    super(code === 'SEAT_ENTRY_NOT_OWN_OPERATIONAL'
      ? 'Permission denied: You can only manage your own operational time entries.'
      : 'Permission denied: Time sheet submission is not available for operational time.');
    this.name = 'SeatTimeAccessError';
  }
}

export async function isSeatTimePrincipal(db: Knex | Knex.Transaction, tenant: string, userId: string, requestCache = new RequestLocalAuthorizationCache()): Promise<boolean> {
  return (await resolveTimeEntryMode(db, tenant, userId, requestCache)) === 'operational';
}

/** Throws unless the entry is the seat technician's own operational entry. Pass `seat` when the caller already resolved it. */
export function assertSeatOwnOperationalEntry(entry: { user_id?: string | null; billing_mode?: string | null }, userId: string): void {
  if (entry.billing_mode !== 'operational' || entry.user_id !== userId) throw new SeatTimeAccessError('SEAT_ENTRY_NOT_OWN_OPERATIONAL');
}

export async function assertTimesheetSubmissionAvailable(db: Knex | Knex.Transaction, tenant: string, userId: string): Promise<void> {
  if (await isSeatTimePrincipal(db, tenant, userId)) throw new SeatTimeAccessError('SEAT_TIMESHEET_SUBMISSION_UNAVAILABLE');
}
