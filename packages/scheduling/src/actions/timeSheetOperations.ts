'use server'

import { Knex } from 'knex'; // Import Knex type
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import {
  ITimeSheet,
  ITimeSheetView,
  ITimePeriodWithStatusView,
  TimeSheetStatus
} from '@alga-psa/types';
import { toPlainDate } from '@alga-psa/core';
import { validateData } from '@alga-psa/validation';
import {
  submitTimeSheetParamsSchema,
  SubmitTimeSheetParams,
  fetchTimePeriodsParamsSchema,
  FetchTimePeriodsParams,
  fetchOrCreateTimeSheetParamsSchema,
  FetchOrCreateTimeSheetParams
} from './timeEntrySchemas'; // Import schemas from the new module
import { withAuth, hasPermission } from '@alga-psa/auth';
import { assertCanActOnBehalf } from './timeEntryDelegationAuth';
import {
  timeSheetActionErrorFrom,
  type TimeSheetActionError,
} from './timeSheetActionErrors';

function captureAnalytics(_event: string, _properties?: Record<string, any>, _userId?: string): void {
  // Intentionally no-op: avoid pulling analytics (and its tenancy/client-portal deps) into scheduling.
}

function tenantScopedTable<Row extends object = Record<string, any>>(
  conn: Knex | Knex.Transaction,
  table: string,
  tenant: string,
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(conn, tenant).table<Row>(table);
}

function timeSheetRemovalErrorMessage(error: unknown): string {
  const mappedError = timeSheetActionErrorFrom(error);
  if (mappedError) {
    return 'permissionError' in mappedError
      ? mappedError.permissionError
      : mappedError.actionError;
  }

  return 'Failed to remove time sheet';
}

// Type for Knex raw query results with aggregate functions
interface TimeEntriesInfo {
  entry_count: number | string;
  total_hours: number | string | null;
}

interface TimePeriodSummaryRow {
  hours_entered: number | string | null;
  days_logged: number | string | null;
  last_entry_date?: string | Date | null;
  entry_count?: number | string | null;
}

function parseNumericValue(value: number | string | null | undefined): number {
  if (value == null) {
    return 0;
  }

  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDateOnlyString(value: string | Date | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return value.slice(0, 10);
}

export const fetchTimeSheets = withAuth(async (user, { tenant }): Promise<ITimeSheet[]> => {
  const currentUserId = user.user_id;

  console.log('Fetching time sheets for user:', currentUserId);

  const {knex: db} = await createTenantKnex();
  const facade = tenantDb(db, tenant);
  const query = facade.table('time_sheets')
    .where({
      'time_sheets.user_id': currentUserId,
    })
    .orderBy('time_periods.start_date', 'desc')
    .select(
      'time_sheets.*',
      'time_periods.start_date',
      'time_periods.end_date'
    );
  facade.tenantJoin(query, 'time_periods', 'time_sheets.period_id', 'time_periods.period_id');

  console.log('SQL Query:', query.toString());

  const timeSheets = (await query) as any[];

  return timeSheets.map((sheet): ITimeSheet => ({
    ...sheet,
    time_period: {
      period_id: sheet.period_id,
      start_date: toPlainDate(sheet.start_date).toString(),
      end_date: toPlainDate(sheet.end_date).toString(),
      tenant: sheet.tenant
    }
  }));
});

export const submitTimeSheet = withAuth(async (user, { tenant }, timeSheetId: string): Promise<ITimeSheet | TimeSheetActionError> => {
  // Validate input
  const validatedParams = validateData<SubmitTimeSheetParams>(submitTimeSheetParamsSchema, { timeSheetId });

  const {knex: db} = await createTenantKnex();

  try {
    if (!await hasPermission(user, 'timesheet', 'submit', db)) {
      throw new Error('Permission denied: Cannot submit timesheets');
    }

    return await db.transaction(async (trx) => {
      // Get timesheet info for analytics
      const timeSheetInfo = await tenantScopedTable(trx, 'time_sheets', tenant)
        .where({
          id: validatedParams.timeSheetId,
        })
        .first();

      if (!timeSheetInfo) {
        throw new Error('Time sheet not found');
      }

      await assertCanActOnBehalf(user, tenant, timeSheetInfo.user_id, trx);

      // Get entry count and total hours for analytics
      const entriesInfo = await tenantScopedTable(trx, 'time_entries', tenant)
        .where({
          time_sheet_id: validatedParams.timeSheetId,
        })
        .select(
          trx.raw('COUNT(*) as entry_count'),
          trx.raw('SUM(billable_duration) / 60 as total_hours')
        )
        .first() as unknown as TimeEntriesInfo | undefined;

      // Get period info
      const periodInfo = await tenantScopedTable(trx, 'time_periods', tenant)
        .where({
          period_id: timeSheetInfo.period_id,
        })
        .first();

      // Update the time sheet status
      const [updatedTimeSheet] = await tenantScopedTable(trx, 'time_sheets', tenant)
        .where({
          id: validatedParams.timeSheetId,
        })
        .update({
          approval_status: 'SUBMITTED',
          submitted_at: trx.fn.now()
        })
        .returning('*');

      // Update all time entries associated with this time sheet
      await tenantScopedTable(trx, 'time_entries', tenant)
        .where({
          time_sheet_id: validatedParams.timeSheetId,
        })
        .update({
          approval_status: 'SUBMITTED',
          updated_at: trx.fn.now()
        });

      // Track analytics
      captureAnalytics('time_sheet_submitted', {
        time_sheet_id: validatedParams.timeSheetId,
        entry_count: entriesInfo?.entry_count || 0,
        total_hours: parseFloat(String(entriesInfo?.total_hours ?? '0')),
        period_start: periodInfo?.start_date,
        period_end: periodInfo?.end_date
      }, user.user_id);

      return updatedTimeSheet as ITimeSheet;
    });
  } catch (error) {
    console.error('Error submitting time sheet:', error);
    const expected = timeSheetActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const fetchAllTimeSheets = withAuth(async (_user, { tenant }): Promise<ITimeSheet[]> => {
  const {knex: db} = await createTenantKnex();
  const facade = tenantDb(db, tenant);

  console.log('Fetching all time sheets');

  const query = facade.table('time_sheets')
    .orderBy('time_periods.start_date', 'desc')
    .select(
      'time_sheets.*',
      'time_periods.start_date',
      'time_periods.end_date'
    );
  facade.tenantJoin(query, 'time_periods', 'time_sheets.period_id', 'time_periods.period_id');

  console.log('SQL Query:', query.toString());

  const timeSheets = (await query) as any[];

  return timeSheets.map((sheet): ITimeSheet => ({
    ...sheet,
    time_period: {
      start_date: toPlainDate(sheet.start_date).toString(),
      end_date: toPlainDate(sheet.end_date).toString()
    }
  }));
});

export const fetchTimePeriods = withAuth(async (user, { tenant }, userId: string): Promise<ITimePeriodWithStatusView[] | TimeSheetActionError> => {
  try {
    // Validate input
    const validatedParams = validateData<FetchTimePeriodsParams>(fetchTimePeriodsParamsSchema, { userId });

    const {knex: db} = await createTenantKnex();

    await assertCanActOnBehalf(user, tenant, validatedParams.userId, db);

    const facade = tenantDb(db, tenant);
    const timeEntrySummaries = facade.table('time_sheets as summary_ts');
    facade.tenantJoin(timeEntrySummaries, 'time_periods as summary_tp', 'summary_ts.period_id', 'summary_tp.period_id');
    facade.tenantJoin(timeEntrySummaries, 'time_entries as te', 'summary_ts.id', 'te.time_sheet_id', {
      type: 'left',
      on(join) {
        join
          .andOn(db.raw('te.work_date >= summary_tp.start_date'))
          .andOn(db.raw('te.work_date < summary_tp.end_date'));
      },
    });
    timeEntrySummaries
      .where({
        'summary_ts.user_id': validatedParams.userId
      })
      .groupBy('summary_ts.period_id', 'summary_ts.tenant')
      .select(
        'summary_ts.period_id',
        'summary_ts.tenant',
        db.raw('COALESCE(SUM(EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 3600.0), 0) as hours_entered'),
        db.raw('COUNT(DISTINCT te.work_date) as days_logged'),
        db.raw('MAX(te.work_date) as last_entry_date')
      )
      .as('tes');

    // True count of time_entries per timesheet (independent of the work_date-filtered
    // summary above), used to decide whether a timesheet is safe to remove.
    const entryCounts = facade.table('time_entries')
      .groupBy('time_sheet_id', 'tenant')
      .select('time_sheet_id', 'tenant')
      .count('* as entry_count')
      .as('ec');

    // Number of timesheets attached to each period across ALL users. Zero => the period
    // itself is unused (no one has logged against it) and is safe to remove entirely.
    const periodSheetCounts = facade.table('time_sheets')
      .groupBy('period_id', 'tenant')
      .select('period_id', 'tenant')
      .count('* as period_sheet_count')
      .as('psc');

    const periodsQuery = facade.table('time_periods as tp');
    facade.tenantJoin(periodsQuery, 'time_sheets as ts', 'tp.period_id', 'ts.period_id', {
      type: 'left',
      on(join) {
        join.andOn('ts.user_id', '=', db.raw('?', [validatedParams.userId]));
      },
    });
    facade.tenantJoinSubquery(periodsQuery, timeEntrySummaries, 'tp.period_id', 'tes.period_id', {
      type: 'left',
      rootTenantColumn: 'tp.tenant',
      joinedTenantColumn: 'tes.tenant',
    });
    facade.tenantJoinSubquery(periodsQuery, entryCounts, 'ts.id', 'ec.time_sheet_id', {
      type: 'left',
      rootTenantColumn: 'tp.tenant',
      joinedTenantColumn: 'ec.tenant',
    });
    facade.tenantJoinSubquery(periodsQuery, periodSheetCounts, 'tp.period_id', 'psc.period_id', {
      type: 'left',
      rootTenantColumn: 'tp.tenant',
      joinedTenantColumn: 'psc.tenant',
    });
    periodsQuery
      .orderBy('tp.start_date', 'desc')
      .select(
        'tp.*',
        'ts.id as time_sheet_id',
        'ts.approval_status',
        db.raw('COALESCE(ts.approval_status, ?) as timeSheetStatus', ['DRAFT']),
        'tes.hours_entered',
        'tes.days_logged',
        'tes.last_entry_date',
        'ec.entry_count',
        'psc.period_sheet_count'
      );
    const periods = (await periodsQuery) as any[];

    console.log('Fetched periods:', periods);

    return periods.map((period): ITimePeriodWithStatusView => {
      const summary = period as typeof period & TimePeriodSummaryRow;

      return {
        ...period,
        start_date: toPlainDate(period.start_date).toString(),
        end_date: toPlainDate(period.end_date).toString(),
        timeSheetStatus: (period.approval_status || period.timeSheetStatus || 'DRAFT') as TimeSheetStatus,
        hoursEntered: parseNumericValue(summary.hours_entered),
        daysLogged: parseNumericValue(summary.days_logged),
        lastEntryDate: toDateOnlyString(summary.last_entry_date),
        timeSheetId: (period as { time_sheet_id?: string | null }).time_sheet_id ?? null,
        entryCount: parseNumericValue(summary.entry_count),
        periodTimesheetCount: parseNumericValue((period as { period_sheet_count?: number | string | null }).period_sheet_count)
      };
    });
  } catch (error) {
    console.error('Error fetching time periods:', error);
    const expected = timeSheetActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export const fetchOrCreateTimeSheet = withAuth(async (user, { tenant }, userId: string, periodId: string): Promise<ITimeSheetView | TimeSheetActionError> => {
  try {
    // Validate input
    const validatedParams = validateData<FetchOrCreateTimeSheetParams>(
      fetchOrCreateTimeSheetParamsSchema,
      { userId, periodId }
    );

    const {knex: db} = await createTenantKnex();

    await assertCanActOnBehalf(user, tenant, validatedParams.userId, db);

    const facade = tenantDb(db, tenant);

    let timeSheet = await facade.table('time_sheets')
      .where({
        user_id: validatedParams.userId,
        period_id: validatedParams.periodId,
      })
      .first();

    if (!timeSheet) {
      [timeSheet] = await facade.table('time_sheets')
        .insert({
          user_id: validatedParams.userId,
          period_id: validatedParams.periodId,
          approval_status: 'DRAFT',
          tenant
        })
        .returning('*');
    }

    const timePeriod = await facade.table('time_periods')
      .where({
        period_id: validatedParams.periodId,
      })
      .first() as any;

    // Fetch comments for the time sheet
    const comments = await facade.table('time_sheet_comments')
      .where({
        time_sheet_id: timeSheet.id,
      })
      .orderBy('created_at', 'desc')
      .select('*');

    return {
      ...timeSheet,
      time_period: {
        ...timePeriod,
        start_date: toPlainDate(timePeriod.start_date).toString(),
        end_date: toPlainDate(timePeriod.end_date).toString()
      },
      comments: comments,
    } as unknown as ITimeSheetView;
  } catch (error) {
    console.error('Error fetching or creating time sheet:', error);
    const expected = timeSheetActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});

export interface DeleteTimeSheetsResult {
  deletedIds: string[];
  failed: Array<{ timeSheetId: string; message: string }>;
}

/**
 * Remove unused/unneeded timesheets when it is safe to do so. A timesheet is only
 * removable when it is an *empty draft*: status DRAFT or CHANGES_REQUESTED with zero
 * time entries. This action is the security boundary — every rule is re-checked
 * server-side per id and never trusts the caller. Removal is per-id and isolated, so a
 * blocked sheet only fails itself (reported in `failed`) without aborting the batch.
 */
export const deleteTimeSheets = withAuth(async (
  user,
  { tenant },
  timeSheetIds: string[]
): Promise<DeleteTimeSheetsResult> => {
  const { knex: db } = await createTenantKnex();

  const uniqueIds = Array.from(
    new Set((timeSheetIds ?? []).filter((id): id is string => typeof id === 'string' && id.length > 0))
  );

  const deletedIds: string[] = [];
  const failed: Array<{ timeSheetId: string; message: string }> = [];

  for (const timeSheetId of uniqueIds) {
    try {
      await db.transaction(async (trx) => {
        const sheet = await tenantScopedTable(trx, 'time_sheets', tenant)
          .where({ id: timeSheetId })
          .first();

        if (!sheet) {
          throw new Error('Time sheet not found');
        }

        // Authorize: caller must own the sheet or have a valid delegation (mirrors submitTimeSheet).
        await assertCanActOnBehalf(user, tenant, sheet.user_id, trx);

        // Only empty drafts are safe to remove.
        if (sheet.approval_status !== 'DRAFT' && sheet.approval_status !== 'CHANGES_REQUESTED') {
          throw new Error('Only draft time sheets can be removed');
        }

        const existingEntry = await tenantScopedTable(trx, 'time_entries', tenant)
          .where({ time_sheet_id: timeSheetId })
          .first('entry_id');

        if (existingEntry) {
          throw new Error('Time sheet still has time entries');
        }

        // CHANGES_REQUESTED sheets can carry approver feedback comments even with no
        // entries; clear them first so the FK to time_sheets does not block the delete.
        await tenantScopedTable(trx, 'time_sheet_comments', tenant)
          .where({ time_sheet_id: timeSheetId })
          .del();

        await tenantScopedTable(trx, 'time_sheets', tenant)
          .where({ id: timeSheetId })
          .del();
      });

      deletedIds.push(timeSheetId);
    } catch (error) {
      failed.push({
        timeSheetId,
        message: timeSheetRemovalErrorMessage(error)
      });
    }
  }

  return { deletedIds, failed };
});
