'use server'

import { Knex } from 'knex'; // Import Knex type
import { createTenantKnex } from '@alga-psa/db';
import {
  ITimeSheet,
  ITimeSheetView,
  ITimePeriodWithStatusView,
  TimeSheetStatus
} from 'server/src/interfaces/timeEntry.interfaces';
import { toPlainDate } from 'server/src/lib/utils/dateTimeUtils';
import { validateData } from '@alga-psa/validation';
import {
  submitTimeSheetParamsSchema,
  SubmitTimeSheetParams,
  fetchTimePeriodsParamsSchema,
  FetchTimePeriodsParams,
  fetchOrCreateTimeSheetParamsSchema,
  FetchOrCreateTimeSheetParams
} from './timeEntrySchemas'; // Import schemas from the new module
import { analytics } from 'server/src/lib/analytics/posthog';
import { AnalyticsEvents } from 'server/src/lib/analytics/events';
import { getSession } from 'server/src/lib/auth/getSession';

export async function fetchTimeSheets(): Promise<ITimeSheet[]> {
  const session = await getSession();
  if (!session?.user?.id) {
    throw new Error("User not authenticated");
  }
  const currentUserId = session.user.id;

  console.log('Fetching time sheets for user:', currentUserId);

  const {knex: db, tenant} = await createTenantKnex();
  const query = db('time_sheets')
    .join('time_periods', function() {
      this.on('time_sheets.period_id', '=', 'time_periods.period_id')
          .andOn('time_sheets.tenant', '=', 'time_periods.tenant');
    })
    .where({
      'time_sheets.user_id': currentUserId,
      'time_sheets.tenant': tenant
    })
    .orderBy('time_periods.start_date', 'desc')
    .select(
      'time_sheets.*',
      'time_periods.start_date',
      'time_periods.end_date'
    );

  console.log('SQL Query:', query.toString());

  const timeSheets = await query;

  return timeSheets.map((sheet): ITimeSheet => ({
    ...sheet,
    time_period: {
      period_id: sheet.period_id,
      start_date: toPlainDate(sheet.start_date).toString(),
      end_date: toPlainDate(sheet.end_date).toString(),
      tenant: sheet.tenant
    }
  }));
}

export async function submitTimeSheet(timeSheetId: string): Promise<ITimeSheet> {
  // Validate input
  const validatedParams = validateData<SubmitTimeSheetParams>(submitTimeSheetParamsSchema, { timeSheetId });

  const session = await getSession();
  const userId = session?.user?.id;

  const {knex: db, tenant} = await createTenantKnex();

  try {
    return await db.transaction(async (trx) => {
      // Get timesheet info for analytics
      const timeSheetInfo = await trx('time_sheets')
        .where({
          id: validatedParams.timeSheetId,
          tenant
        })
        .first();

      // Get entry count and total hours for analytics
      const entriesInfo = await trx('time_entries')
        .where({
          time_sheet_id: validatedParams.timeSheetId,
          tenant
        })
        .select(
          trx.raw('COUNT(*) as entry_count'),
          trx.raw('SUM(billable_duration) / 60 as total_hours')
        )
        .first();

      // Get period info
      const periodInfo = await trx('time_periods')
        .where({
          period_id: timeSheetInfo.period_id,
          tenant
        })
        .first();

      // Update the time sheet status
      const [updatedTimeSheet] = await trx('time_sheets')
        .where({
          id: validatedParams.timeSheetId,
          tenant
        })
        .update({
          approval_status: 'SUBMITTED',
          submitted_at: trx.fn.now()
        })
        .returning('*');

      // Update all time entries associated with this time sheet
      await trx('time_entries')
        .where({
          time_sheet_id: validatedParams.timeSheetId,
          tenant
        })
        .update({
          approval_status: 'SUBMITTED',
          updated_at: trx.fn.now()
        });

      // Track analytics
      if (userId) {
        analytics.capture(AnalyticsEvents.TIME_SHEET_SUBMITTED, {
          time_sheet_id: validatedParams.timeSheetId,
          entry_count: entriesInfo?.entry_count || 0,
          total_hours: parseFloat(entriesInfo?.total_hours || '0'),
          period_start: periodInfo?.start_date,
          period_end: periodInfo?.end_date
        }, userId);
      }

      return updatedTimeSheet;
    });
  } catch (error) {
    console.error('Error submitting time sheet:', error);
    throw new Error('Failed to submit time sheet');
  }
}

export async function fetchAllTimeSheets(): Promise<ITimeSheet[]> {
  const {knex: db, tenant} = await createTenantKnex();

  console.log('Fetching all time sheets');

  const query = db('time_sheets')
    .join('time_periods', function() {
      this.on('time_sheets.period_id', '=', 'time_periods.period_id')
          .andOn('time_sheets.tenant', '=', 'time_periods.tenant');
    })
    .where('time_sheets.tenant', tenant)
    .orderBy('time_periods.start_date', 'desc')
    .select(
      'time_sheets.*',
      'time_periods.start_date',
      'time_periods.end_date'
    );

  console.log('SQL Query:', query.toString());

  const timeSheets = await query;

  return timeSheets.map((sheet): ITimeSheet => ({
    ...sheet,
    time_period: {
      start_date: toPlainDate(sheet.start_date).toString(),
      end_date: toPlainDate(sheet.end_date).toString()
    }
  }));
}

export async function fetchTimePeriods(userId: string): Promise<ITimePeriodWithStatusView[]> {
  // Validate input
  const validatedParams = validateData<FetchTimePeriodsParams>(fetchTimePeriodsParamsSchema, { userId });

  const {knex: db, tenant} = await createTenantKnex();

  const periods = await db('time_periods as tp')
    .leftJoin('time_sheets as ts', function() {
      this.on('tp.period_id', '=', 'ts.period_id')
          .andOn('tp.tenant', '=', 'ts.tenant')
          .andOn('ts.user_id', '=', db.raw('?', [validatedParams.userId]));
    })
    .where({ 'tp.tenant': tenant })
    .orderBy('tp.start_date', 'desc')
    .select(
      'tp.*',
      'ts.approval_status',
      db.raw('COALESCE(ts.approval_status, ?) as timeSheetStatus', ['DRAFT'])
    );

  console.log('Fetched periods:', periods);

  return periods.map((period): ITimePeriodWithStatusView => ({
    ...period,
    start_date: toPlainDate(period.start_date).toString(),
    end_date: toPlainDate(period.end_date).toString(),
    timeSheetStatus: (period.approval_status || period.timeSheetStatus || 'DRAFT') as TimeSheetStatus
  }));
}

export async function fetchOrCreateTimeSheet(userId: string, periodId: string): Promise<ITimeSheetView> {
  // Validate input
  const validatedParams = validateData<FetchOrCreateTimeSheetParams>(
    fetchOrCreateTimeSheetParamsSchema,
    { userId, periodId }
  );

  const {knex: db, tenant} = await createTenantKnex();

  let timeSheet = await db('time_sheets')
    .where({
      user_id: validatedParams.userId,
      period_id: validatedParams.periodId,
      tenant
    })
    .first();

  if (!timeSheet) {
    [timeSheet] = await db('time_sheets')
      .insert({
        user_id: validatedParams.userId,
        period_id: validatedParams.periodId,
        approval_status: 'DRAFT',
        tenant
      })
      .returning('*');
  }

  const timePeriod = await db('time_periods')
    .where({
      period_id: validatedParams.periodId,
      tenant
    })
    .first();

  // Fetch comments for the time sheet
  const comments = await db('time_sheet_comments')
    .where({
      time_sheet_id: timeSheet.id,
      tenant
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
  };
}
