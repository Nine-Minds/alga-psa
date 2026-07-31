import ScheduleEntry from '@alga-psa/shared/models/scheduleEntry';
import type { IScheduleEntry } from '@alga-psa/types';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';

/**
 * Identity-explicit core for the user-activities schedule fetch.
 *
 * Fetches a user's date-windowed schedule entries (with recurrence/virtual-occurrence
 * expansion via the ScheduleEntry model) and filters to those assigned to the user.
 *
 * Deliberately NOT `'use server'` and NOT `withAuth`-wrapped: it performs NO auth or
 * permission check — the CALLER is responsible for gating. This is the key difference from
 * `getScheduleActivityEntries`, whose `withAuth` wrapper resolves the user from the NextAuth
 * session (which is null under API-key auth), so the v1 REST API could not use it — every
 * schedule + ad-hoc item silently vanished from the mobile activities list.
 *
 * Callers and how they gate:
 *  - the `withAuth` web wrapper `getScheduleActivityEntries`, which does the self/other
 *    permission check, then delegates here, and
 *  - the user-activities aggregation, which gates `targetUserId` up front via
 *    `resolveActivityTarget` (user_schedule:update / read_all) before fanning out.
 */
export async function getScheduleActivityEntriesForUser(
  tenant: string,
  targetUserId: string,
  start: Date,
  end: Date,
): Promise<IScheduleEntry[]> {
  const { knex } = await createTenantKnex(tenant);
  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const entries = await ScheduleEntry.getAll(trx, tenant, start, end);
    return entries.filter((entry) => entry.assigned_user_ids.includes(targetUserId));
  });
}
