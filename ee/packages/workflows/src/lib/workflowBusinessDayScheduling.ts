import type { Knex } from 'knex';
import { parseExpression } from 'cron-parser';
import type { WorkflowScheduleDayTypeFilter } from '@alga-psa/workflows/persistence';

type BusinessHoursScheduleRow = {
  tenant: string;
  schedule_id: string;
  schedule_name: string;
  timezone: string;
  is_default: boolean;
  is_24x7: boolean;
};

type BusinessHoursEntryRow = {
  tenant: string;
  schedule_id: string;
  day_of_week: number;
  is_enabled: boolean;
};

type HolidayRow = {
  tenant: string;
  schedule_id: string | null;
  holiday_date: string;
  is_recurring: boolean;
};

export type WorkflowBusinessDayValidationCode =
  | 'DAY_FILTER_NOT_ALLOWED_FOR_ONE_TIME'
  | 'BUSINESS_HOURS_OVERRIDE_NOT_FOUND'
  | 'BUSINESS_HOURS_SCHEDULE_REQUIRED';

export type WorkflowBusinessDayValidationIssue = {
  code: WorkflowBusinessDayValidationCode;
  message: string;
};

export type WorkflowBusinessDayResolution = {
  scheduleId: string;
  scheduleName: string;
  source: 'override' | 'tenant_default';
  scheduleTimezone: string;
  is24x7: boolean;
  entries: BusinessHoursEntryRow[];
  holidays: HolidayRow[];
};

type ResolveParams = {
  tenantId: string;
  dayTypeFilter: WorkflowScheduleDayTypeFilter;
  businessHoursScheduleId?: string | null;
};

type ResolveResult =
  | { ok: true; value: WorkflowBusinessDayResolution | null }
  | { ok: false; issue: WorkflowBusinessDayValidationIssue };

export type WorkflowDayClassification = 'business' | 'non_business';

type LocalDateInfo = {
  localDate: string;
  dayOfWeek: number;
};

const WEEKDAY_TO_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6
};

const BOUNDED_NEXT_ELIGIBLE_LIMIT = 366;
const BOUNDED_NEXT_ELIGIBLE_OCCURRENCES = 512;

export const normalizeWorkflowDayTypeFilter = (
  value: unknown
): WorkflowScheduleDayTypeFilter => {
  if (value === 'business' || value === 'non_business') {
    return value;
  }
  return 'any';
};

const toLocalDateInfo = (occurrence: Date, timezone: string): LocalDateInfo => {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short'
  });
  const parts = formatter.formatToParts(occurrence);
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  const weekday = (parts.find((part) => part.type === 'weekday')?.value ?? 'Sun').toLowerCase().slice(0, 3);
  return {
    localDate: `${year}-${month}-${day}`,
    dayOfWeek: WEEKDAY_TO_INDEX[weekday] ?? 0
  };
};

const isHolidayForLocalDate = (
  holidays: HolidayRow[],
  localDate: string
): boolean => {
  const monthDay = localDate.slice(5);
  return holidays.some((holiday) => (
    holiday.is_recurring
      ? holiday.holiday_date.slice(5) === monthDay
      : holiday.holiday_date === localDate
  ));
};

export const classifyWorkflowOccurrenceDay = (params: {
  occurrence: Date;
  occurrenceTimezone: string;
  resolution: WorkflowBusinessDayResolution;
}): WorkflowDayClassification => {
  const localDateInfo = toLocalDateInfo(params.occurrence, params.occurrenceTimezone);
  if (isHolidayForLocalDate(params.resolution.holidays, localDateInfo.localDate)) {
    return 'non_business';
  }

  if (params.resolution.is24x7) {
    return 'business';
  }

  const entry = params.resolution.entries.find((candidate) => candidate.day_of_week === localDateInfo.dayOfWeek);
  if (!entry || !entry.is_enabled) {
    return 'non_business';
  }
  return 'business';
};

export const isWorkflowOccurrenceEligible = (params: {
  dayTypeFilter: WorkflowScheduleDayTypeFilter;
  occurrence: Date;
  occurrenceTimezone: string;
  resolution: WorkflowBusinessDayResolution | null;
}): boolean => {
  if (params.dayTypeFilter === 'any') return true;
  if (!params.resolution) return false;
  const classification = classifyWorkflowOccurrenceDay({
    occurrence: params.occurrence,
    occurrenceTimezone: params.occurrenceTimezone,
    resolution: params.resolution
  });
  return params.dayTypeFilter === classification;
};

export const resolveWorkflowBusinessDaySettings = async (
  knex: Knex,
  params: ResolveParams
): Promise<ResolveResult> => {
  const dayTypeFilter = normalizeWorkflowDayTypeFilter(params.dayTypeFilter);
  const overrideId = params.businessHoursScheduleId ?? null;

  if (dayTypeFilter === 'any') {
    if (!overrideId) {
      return { ok: true, value: null };
    }

    const overrideSchedule = await knex<BusinessHoursScheduleRow>('business_hours_schedules')
      .where({ tenant: params.tenantId, schedule_id: overrideId })
      .first();
    if (!overrideSchedule) {
      return {
        ok: false,
        issue: {
          code: 'BUSINESS_HOURS_OVERRIDE_NOT_FOUND',
          message: 'Selected business-hours schedule is invalid for this tenant.'
        }
      };
    }

    const entries = await knex<BusinessHoursEntryRow>('business_hours_entries')
      .where({ tenant: params.tenantId, schedule_id: overrideSchedule.schedule_id });
    const holidays = await knex<HolidayRow>('holidays')
      .where({ tenant: params.tenantId })
      .where(function whereGlobalOrScheduleSpecific() {
        this.whereNull('schedule_id').orWhere('schedule_id', overrideSchedule.schedule_id);
      });

    return {
      ok: true,
      value: {
        scheduleId: overrideSchedule.schedule_id,
        scheduleName: overrideSchedule.schedule_name,
        source: 'override',
        scheduleTimezone: overrideSchedule.timezone,
        is24x7: Boolean(overrideSchedule.is_24x7),
        entries,
        holidays
      }
    };
  }

  let selectedSchedule: BusinessHoursScheduleRow | undefined;
  let source: 'override' | 'tenant_default' = 'tenant_default';

  if (overrideId) {
    selectedSchedule = await knex<BusinessHoursScheduleRow>('business_hours_schedules')
      .where({ tenant: params.tenantId, schedule_id: overrideId })
      .first();
    source = 'override';
    if (!selectedSchedule) {
      return {
        ok: false,
        issue: {
          code: 'BUSINESS_HOURS_OVERRIDE_NOT_FOUND',
          message: 'Selected business-hours schedule is invalid for this tenant.'
        }
      };
    }
  } else {
    selectedSchedule = await knex<BusinessHoursScheduleRow>('business_hours_schedules')
      .where({ tenant: params.tenantId, is_default: true })
      .first();
    if (!selectedSchedule) {
      return {
        ok: false,
        issue: {
          code: 'BUSINESS_HOURS_SCHEDULE_REQUIRED',
          message: 'Business/non-business day filters require a default business-hours schedule or a specific override.'
        }
      };
    }
  }

  const entries = await knex<BusinessHoursEntryRow>('business_hours_entries')
    .where({ tenant: params.tenantId, schedule_id: selectedSchedule.schedule_id });
  const holidays = await knex<HolidayRow>('holidays')
    .where({ tenant: params.tenantId })
    .where(function whereGlobalOrScheduleSpecific() {
      this.whereNull('schedule_id').orWhere('schedule_id', selectedSchedule.schedule_id);
    });

  return {
    ok: true,
    value: {
      scheduleId: selectedSchedule.schedule_id,
      scheduleName: selectedSchedule.schedule_name,
      source,
      scheduleTimezone: selectedSchedule.timezone,
      is24x7: Boolean(selectedSchedule.is_24x7),
      entries,
      holidays
    }
  };
};

export const computeNextEligibleRecurringFireAt = (params: {
  cron: string;
  timezone: string;
  dayTypeFilter: WorkflowScheduleDayTypeFilter;
  resolution: WorkflowBusinessDayResolution | null;
  after?: Date;
  maxOccurrences?: number;
  maxDaysAhead?: number;
}): string | null => {
  if (!params.cron) return null;
  if (params.dayTypeFilter !== 'any' && !params.resolution) return null;

  const startAt = params.after ?? new Date();
  const cutoff = new Date(startAt.getTime() + (params.maxDaysAhead ?? BOUNDED_NEXT_ELIGIBLE_LIMIT) * 24 * 60 * 60 * 1000);
  const maxOccurrences = params.maxOccurrences ?? BOUNDED_NEXT_ELIGIBLE_OCCURRENCES;

  let expression;
  try {
    expression = parseExpression(params.cron, {
      currentDate: startAt,
      tz: params.timezone || 'UTC'
    });
  } catch {
    return null;
  }

  for (let index = 0; index < maxOccurrences; index += 1) {
    let nextOccurrence: Date;
    try {
      nextOccurrence = expression.next().toDate();
    } catch {
      return null;
    }
    if (nextOccurrence > cutoff) {
      return null;
    }

    if (isWorkflowOccurrenceEligible({
      dayTypeFilter: params.dayTypeFilter,
      occurrence: nextOccurrence,
      occurrenceTimezone: params.timezone || 'UTC',
      resolution: params.resolution
    })) {
      return nextOccurrence.toISOString();
    }
  }

  return null;
};
