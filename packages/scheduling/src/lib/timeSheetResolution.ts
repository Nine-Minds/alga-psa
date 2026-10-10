import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { actionError } from '@alga-psa/ui/lib/errorHandling';
import { TimePeriod } from '../models/timePeriod';
import { TimeSheetResolutionError } from '../actions/timeSheetActionErrors';
import { isEditableSheetStatus } from './timeEntryPeriodSelection';

/**
 * Server-side time sheet resolution, shared by the client-driven path
 * (`fetchOrCreateTimeSheet` action, used by `createCatalogSheetResolver` in
 * timeEntrySaveAdapter.ts) and server-only callers such as the stopwatch log.
 *
 * Authorization is NOT performed here: callers must already have checked that
 * the actor may act on behalf of `userId` (see assertCanActOnBehalf).
 */

/**
 * Find the user's time sheet for a period, creating an empty DRAFT sheet when
 * none exists. Works on a Knex instance or a caller-owned transaction.
 */
export async function findOrCreateTimeSheetRow(
  conn: Knex | Knex.Transaction,
  tenant: string,
  userId: string,
  periodId: string,
): Promise<any> {
  const facade = tenantDb(conn, tenant);

  let timeSheet = await facade.table('time_sheets')
    .where({
      user_id: userId,
      period_id: periodId,
    })
    .first();

  if (!timeSheet) {
    [timeSheet] = await facade.table('time_sheets')
      .insert({
        user_id: userId,
        period_id: periodId,
        approval_status: 'DRAFT',
        tenant,
      })
      .returning('*');
  }

  return timeSheet;
}

export interface ResolvedTimeSheet {
  timeSheetId: string;
  periodId: string;
  approvalStatus: string;
}

const STATUS_FALLBACKS: Record<string, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Changes Requested',
};

/**
 * Resolve (finding or creating) the sheet that holds `workDate` for `userId`.
 *
 * `workDate` is a YYYY-MM-DD calendar date already computed in the subject
 * user's timezone (computeWorkDateFields). Periods are half-open
 * [start_date, end_date). Periods are tenant-wide and only ever looked up here;
 * they are created by the time-period settings, not on demand.
 *
 * Throws TimeSheetResolutionError (an expected, user-actionable error that
 * timeSheetActionErrorFrom converts unchanged) when no period covers the date
 * or the sheet is locked (anything but DRAFT / CHANGES_REQUESTED). Throwing
 * lets a caller-owned transaction roll back. The save path still repeats the
 * status check under a row lock; this pass gives the precise reason early.
 */
export async function resolveTimeSheetForWorkDate(
  trx: Knex | Knex.Transaction,
  tenant: string,
  userId: string,
  workDate: string,
): Promise<ResolvedTimeSheet> {
  const day = workDate.slice(0, 10);

  const period = await TimePeriod.findByDate(trx, tenant, day);
  if (!period) {
    throw new TimeSheetResolutionError(
      `No time period covers ${day}`,
      actionError(
        `No time period covers ${day}. Pick a day inside a time period.`,
        'msp/time-entry:workItemEntry.save.noPeriod',
        { date: day },
      ),
    );
  }

  const sheet = await findOrCreateTimeSheetRow(trx, tenant, userId, period.period_id);

  if (!isEditableSheetStatus(sheet.approval_status)) {
    const status = STATUS_FALLBACKS[sheet.approval_status] ?? 'Unknown';
    throw new TimeSheetResolutionError(
      `Time sheet is not editable (${sheet.approval_status})`,
      actionError(
        `The time sheet for ${day} is ${status}. Pick a day on a draft sheet or one with changes requested.`,
        'msp/time-entry:workItemEntry.save.sheetLocked',
        { date: day, status },
      ),
    );
  }

  return {
    timeSheetId: sheet.id,
    periodId: period.period_id,
    approvalStatus: sheet.approval_status,
  };
}
