import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import {
  buildFallbackBusinessDayCalendar,
  createBusinessDayCalendar,
  normalizeHolidayDate,
  type BusinessDayCalendar,
  type BusinessDayEntryInput,
  type BusinessDayHolidayInput,
} from './businessDayCalendar';

type ScheduleRow = {
  schedule_id: string;
  schedule_name: string;
  timezone: string;
  is_24x7: boolean;
};

/**
 * Loads the tenant's business-day calendar from its default business-hours schedule (plus tenant-wide
 * and schedule-specific holidays). Tenants are not seeded with a default schedule, so when none
 * exists this returns the Mon–Fri + tenant-wide-holidays fallback; `calendar.source` tells callers
 * which one they got so the UI can say so.
 */
export async function loadTenantBusinessDayCalendar(
  conn: Knex | Knex.Transaction,
  tenant: string
): Promise<BusinessDayCalendar> {
  const db = tenantDb(conn, tenant);

  const schedule = (await db.table('business_hours_schedules').where({ is_default: true }).first()) as
    | ScheduleRow
    | undefined;

  const holidayQuery = db.table('holidays');
  if (schedule) {
    holidayQuery.where(function whereGlobalOrScheduleSpecific() {
      this.whereNull('schedule_id').orWhere('schedule_id', schedule.schedule_id);
    });
  } else {
    holidayQuery.whereNull('schedule_id');
  }
  const holidayRows = (await holidayQuery) as BusinessDayHolidayInput[];
  // Skip malformed DATE rows rather than failing the whole sweep.
  const holidays = holidayRows.flatMap((holiday) => {
    const date = normalizeHolidayDate(holiday.holiday_date);
    return date ? [{ holiday_date: date, is_recurring: Boolean(holiday.is_recurring) }] : [];
  });

  if (!schedule) {
    return buildFallbackBusinessDayCalendar(holidays);
  }

  const entries = (await db
    .table('business_hours_entries')
    .where({ schedule_id: schedule.schedule_id })) as BusinessDayEntryInput[];

  return createBusinessDayCalendar(
    { is24x7: Boolean(schedule.is_24x7), entries, holidays },
    { source: 'default_schedule', scheduleName: schedule.schedule_name, timezone: schedule.timezone }
  );
}
