'use server';

import type { IScheduleEntry } from '@alga-psa/types';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { getScheduleActivityEntriesForUser } from './scheduleActivityCore';

/**
 * Fetch schedule entries (with recurrence/virtual-occurrence expansion) for the
 * user-activities dashboard.
 *
 * This action owns ScheduleEntry model access on behalf of `@alga-psa/user-activities`,
 * so that feature package never imports the schedule model (which lives in
 * `@alga-psa/shared`). It is the schedule-domain equivalent of the cross-feature
 * `getConsolidatedTicketData` / `getTaskWithDetails` seams the dashboard already uses.
 *
 * Semantics differ deliberately from `getScheduleEntries` (scheduleActions.ts):
 * - This is always the *target user's* own view. Self is always allowed; viewing
 *   another user requires `user_schedule:update` OR `user_schedule:read_all`
 *   (the same gate the activities dashboard uses to view another user's activities).
 *   `getScheduleEntries` only honors `technicianIds` under `update`, so a
 *   `read_all`-only manager would silently get nothing there.
 * - Returns only entries assigned to `targetUserId`. Unassigned `appointment_request`
 *   entries (empty assignee list) are therefore excluded.
 * - No caller-private masking. Because every returned entry is assigned to the target
 *   user, we do not blank private entries to "Busy" the way `getScheduleEntries` does
 *   for a non-assignee caller.
 *
 * Date-windowed by [start, end]; dateless ad-hoc items are surfaced separately by the
 * user-activities aggregation via raw queries on `schedule_entries` (no model import).
 */
export const getScheduleActivityEntries = withAuth(async (
  user,
  { tenant },
  targetUserId: string,
  start: Date,
  end: Date
): Promise<IScheduleEntry[]> => {
  if (targetUserId !== user.user_id) {
    const { knex } = await createTenantKnex();
    const [canUpdate, canReadAll] = await Promise.all([
      hasPermission(user, 'user_schedule', 'update', knex),
      hasPermission(user, 'user_schedule', 'read_all', knex),
    ]);
    if (!canUpdate && !canReadAll) {
      throw new Error("Permission denied: cannot view another user's schedule activities");
    }
  }

  // Permission gate passed (or self) → delegate to the identity-explicit core.
  return getScheduleActivityEntriesForUser(tenant, targetUserId, start, end);
});
