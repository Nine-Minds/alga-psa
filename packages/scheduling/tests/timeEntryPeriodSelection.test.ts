import { describe, expect, it } from 'vitest';
import {
  dateOnlyToLocalDate,
  editableDateRange,
  instantAtZonedTime,
  isEditableSheetStatus,
  isEditableWorkDate,
  isWithinPeriod,
  nearestEditableWorkDate,
  periodForWorkDate,
  periodLastInclusiveDay,
  resolveEntryDefaults,
  resolveSingleDayPlanDefaults,
  workDateInTimeZone,
  zonedWorkDayCalendar,
} from '../src/lib/timeEntryPeriodSelection';
import { toEntryPlan, toEntrySpan } from '../src/lib/stopwatch/stopwatchMath';

const weeklyPeriod = { start_date: '2026-09-07', end_date: '2026-09-14' };

// Newest first, as fetchTimePeriods returns them. The week of Aug 17 is
// Submitted and Aug 24–30 has no period at all.
const catalog = [
  { period_id: 'sep-07', start_date: '2026-09-07', end_date: '2026-09-14', timeSheetStatus: 'DRAFT' },
  { period_id: 'aug-31', start_date: '2026-08-31', end_date: '2026-09-07', timeSheetStatus: 'CHANGES_REQUESTED' },
  { period_id: 'aug-17', start_date: '2026-08-17', end_date: '2026-08-24', timeSheetStatus: 'SUBMITTED' },
  { period_id: 'aug-10', start_date: '2026-08-10', end_date: '2026-08-17', timeSheetStatus: 'DRAFT' },
];
const lockedThisWeek = catalog.map((period) =>
  period.period_id === 'sep-07' ? { ...period, timeSheetStatus: 'APPROVED' } : period,
);

describe('timeEntryPeriodSelection', () => {
  describe('isEditableSheetStatus', () => {
    it('accepts only DRAFT and CHANGES_REQUESTED', () => {
      expect(isEditableSheetStatus('DRAFT')).toBe(true);
      expect(isEditableSheetStatus('CHANGES_REQUESTED')).toBe(true);
      expect(isEditableSheetStatus('SUBMITTED')).toBe(false);
      expect(isEditableSheetStatus('APPROVED')).toBe(false);
      expect(isEditableSheetStatus('WHATEVER')).toBe(false);
      expect(isEditableSheetStatus(null)).toBe(false);
      expect(isEditableSheetStatus(undefined)).toBe(false);
    });
  });

  describe('period bounds', () => {
    it('derives the inclusive last day from the exclusive end_date', () => {
      expect(periodLastInclusiveDay('2026-09-14')).toBe('2026-09-13');
      expect(periodLastInclusiveDay('2026-03-01')).toBe('2026-02-28');
      expect(periodLastInclusiveDay('2028-03-01')).toBe('2028-02-29');
    });

    it('keeps the half-open [start, end) contract', () => {
      expect(isWithinPeriod('2026-09-07T00:00:00Z', weeklyPeriod, 'UTC')).toBe(true);
      expect(isWithinPeriod('2026-09-13T23:59:59Z', weeklyPeriod, 'UTC')).toBe(true);
      expect(isWithinPeriod('2026-09-14T00:00:00Z', weeklyPeriod, 'UTC')).toBe(false);
      expect(isWithinPeriod('2026-09-06T23:59:59Z', weeklyPeriod, 'UTC')).toBe(false);
    });

    it('evaluates membership in the subject timezone, not the browser timezone', () => {
      // 2026-09-14T02:00Z is still 2026-09-13 in New York (in period) but the
      // 14th in UTC (out of period).
      const instant = '2026-09-14T02:00:00Z';
      expect(workDateInTimeZone(instant, 'America/New_York')).toBe('2026-09-13');
      expect(workDateInTimeZone(instant, 'UTC')).toBe('2026-09-14');
      expect(isWithinPeriod(instant, weeklyPeriod, 'America/New_York')).toBe(true);
      expect(isWithinPeriod(instant, weeklyPeriod, 'UTC')).toBe(false);
    });
  });

  describe('instantAtZonedTime', () => {
    it('maps wall-clock time in the subject timezone to the right instant', () => {
      const start = instantAtZonedTime('2026-09-07', '08:00', 'America/New_York');
      // 08:00 EDT == 12:00 UTC
      expect(start.toISOString()).toBe('2026-09-07T12:00:00.000Z');
      expect(workDateInTimeZone(start, 'America/New_York')).toBe('2026-09-07');
    });

    it('honours DST offsets across the transition', () => {
      const beforeDst = instantAtZonedTime('2026-03-07', '08:00', 'America/New_York');
      const afterDst = instantAtZonedTime('2026-03-09', '08:00', 'America/New_York');
      // EST (UTC-5) then EDT (UTC-4).
      expect(beforeDst.toISOString()).toBe('2026-03-07T13:00:00.000Z');
      expect(afterDst.toISOString()).toBe('2026-03-09T12:00:00.000Z');
    });
  });

  describe('period catalog', () => {
    it('finds the period covering a day using half-open bounds', () => {
      expect(periodForWorkDate(catalog, '2026-09-13')?.period_id).toBe('sep-07');
      expect(periodForWorkDate(catalog, '2026-09-07')?.period_id).toBe('sep-07');
      expect(periodForWorkDate(catalog, '2026-09-06')?.period_id).toBe('aug-31');
      expect(periodForWorkDate(catalog, '2026-08-26')).toBeNull();
      expect(periodForWorkDate(catalog, '2026-09-14')).toBeNull();
    });

    it('treats only days on draft or changes-requested sheets as editable', () => {
      expect(isEditableWorkDate(catalog, '2026-09-08')).toBe(true);
      expect(isEditableWorkDate(catalog, '2026-09-01')).toBe(true);
      expect(isEditableWorkDate(catalog, '2026-08-18')).toBe(false);
      expect(isEditableWorkDate(catalog, '2026-08-26')).toBe(false);
      expect(isEditableWorkDate(catalog, '2026-08-11')).toBe(true);
    });

    it('spans the editable periods from first to last inclusive day', () => {
      expect(editableDateRange(catalog)).toEqual({ firstDay: '2026-08-10', lastDay: '2026-09-13' });
      expect(editableDateRange(catalog.map((p) => ({ ...p, timeSheetStatus: 'SUBMITTED' })))).toBeNull();
    });

    it('picks today, else the latest editable day before it, else the earliest after it', () => {
      expect(nearestEditableWorkDate(catalog, '2026-09-09')).toBe('2026-09-09');
      expect(nearestEditableWorkDate(lockedThisWeek, '2026-09-09')).toBe('2026-09-06');
      expect(nearestEditableWorkDate(catalog, '2026-08-20')).toBe('2026-08-16');
      expect(nearestEditableWorkDate(catalog, '2026-08-01')).toBe('2026-08-10');
      expect(nearestEditableWorkDate([], '2026-08-01')).toBeNull();
    });
  });

  describe('resolveEntryDefaults', () => {
    const now = new Date('2026-09-09T15:00:00Z');

    it('keeps context timestamps that fall on one editable period', () => {
      const start = new Date('2026-08-11T13:00:00Z');
      const end = new Date('2026-08-11T14:30:00Z');
      const resolved = resolveEntryDefaults({
        context: { startTime: start, endTime: end },
        periods: catalog,
        timeZone: 'UTC',
        now,
      })!;
      expect(resolved.moved).toEqual({ kind: 'none' });
      expect(resolved.source).toBe('context');
      expect(resolved.defaultStartTime).toEqual(start);
      expect(resolved.defaultEndTime).toEqual(end);
    });

    it('moves context timestamps on a locked sheet to today at 08:00', () => {
      const resolved = resolveEntryDefaults({
        context: {
          startTime: new Date('2026-08-18T09:00:00Z'),
          endTime: new Date('2026-08-18T10:00:00Z'),
        },
        periods: catalog,
        timeZone: 'UTC',
        now,
      })!;
      expect(resolved.moved).toEqual({ kind: 'supplied', date: '2026-09-09' });
      expect(resolved.defaultStartTime.toISOString()).toBe('2026-09-09T08:00:00.000Z');
      expect(resolved.defaultEndTime.toISOString()).toBe('2026-09-09T09:00:00.000Z');
    });

    it('moves a timer span that straddles two periods', () => {
      const resolved = resolveEntryDefaults({
        context: {
          startTime: new Date('2026-09-06T23:30:00Z'),
          endTime: new Date('2026-09-07T00:30:00Z'),
        },
        periods: catalog,
        timeZone: 'UTC',
        now,
      })!;
      expect(resolved.moved.kind).toBe('supplied');
    });

    it('defaults to today at 08:00 with explicit times so ad-hoc/schedule rows cannot land elsewhere', () => {
      const resolved = resolveEntryDefaults({ context: {}, periods: catalog, timeZone: 'UTC', now })!;
      expect(resolved.source).toBe('none');
      expect(resolved.moved).toEqual({ kind: 'none' });
      expect(resolved.defaultStartTime.toISOString()).toBe('2026-09-09T08:00:00.000Z');
      expect(resolved.defaultEndTime.toISOString()).toBe('2026-09-09T09:00:00.000Z');
    });

    it('moves off a locked today to the nearest editable day and reports the status', () => {
      const resolved = resolveEntryDefaults({ context: {}, periods: lockedThisWeek, timeZone: 'UTC', now })!;
      expect(resolved.moved).toEqual({ kind: 'today', date: '2026-09-06', todayStatus: 'APPROVED' });
      expect(resolved.defaultStartTime.toISOString()).toBe('2026-09-06T08:00:00.000Z');
    });

    it('reports an uncovered today with a null status', () => {
      const resolved = resolveEntryDefaults({
        context: {},
        periods: catalog,
        timeZone: 'UTC',
        now: new Date('2026-08-26T12:00:00Z'),
      })!;
      expect(resolved.moved).toEqual({ kind: 'today', date: '2026-08-16', todayStatus: null });
    });

    it('returns null when no period accepts time', () => {
      expect(
        resolveEntryDefaults({
          context: {},
          periods: catalog.map((p) => ({ ...p, timeSheetStatus: 'APPROVED' })),
          timeZone: 'UTC',
          now,
        }),
      ).toBeNull();
    });

    it('derives today and the 08:00 default in the subject timezone', () => {
      // 02:00 UTC on Sep 7 is still Sep 6 in New York, which is on the changes-requested sheet.
      const resolved = resolveEntryDefaults({
        context: {},
        periods: catalog,
        timeZone: 'America/New_York',
        now: new Date('2026-09-07T02:00:00Z'),
      })!;
      expect(resolved.moved).toEqual({ kind: 'none' });
      expect(resolved.defaultStartTime.toISOString()).toBe('2026-09-06T12:00:00.000Z');
      expect(workDateInTimeZone(resolved.defaultStartTime, 'America/New_York')).toBe('2026-09-06');
    });

    it('treats a date-only string as local midnight, not UTC', () => {
      const date = dateOnlyToLocalDate('2026-09-07');
      expect(date.getFullYear()).toBe(2026);
      expect(date.getMonth()).toBe(8);
      expect(date.getDate()).toBe(7);
    });
  });
});

describe('zonedWorkDayCalendar', () => {
  const at = (iso: string) => Date.parse(iso);

  it('UTC: days split at 00:00Z', () => {
    const cal = zonedWorkDayCalendar('UTC');
    expect(cal.dayOf(at('2026-10-28T23:59:59Z'))).toBe('2026-10-28');
    expect(cal.nextDayStart(at('2026-10-28T23:59:59Z'))).toBe(at('2026-10-29T00:00:00Z'));
  });

  it('falls back to UTC for a missing or invalid zone', () => {
    expect(zonedWorkDayCalendar(null).nextDayStart(at('2026-10-28T10:00:00Z'))).toBe(at('2026-10-29T00:00:00Z'));
    expect(zonedWorkDayCalendar('Not/AZone').dayOf(at('2026-10-28T10:00:00Z'))).toBe('2026-10-28');
  });

  it('America/New_York: midnight is local, DST days are 23h and 25h', () => {
    const cal = zonedWorkDayCalendar('America/New_York');
    expect(cal.dayOf(at('2026-10-29T03:59:00Z'))).toBe('2026-10-28');
    expect(cal.nextDayStart(at('2026-10-29T03:59:00Z'))).toBe(at('2026-10-29T04:00:00Z'));
    expect(cal.nextDayStart(at('2026-03-08T06:00:00Z')) - at('2026-03-08T05:00:00Z')).toBe(23 * 3600_000);
    expect(cal.nextDayStart(at('2026-11-01T05:00:00Z')) - at('2026-11-01T04:00:00Z')).toBe(25 * 3600_000);
  });

  it('+13 zone (Pacific/Auckland)', () => {
    const cal = zonedWorkDayCalendar('Pacific/Auckland');
    // 2026-01-15T10:30Z is 23:30 NZDT on the 15th
    expect(cal.dayOf(at('2026-01-15T10:30:00Z'))).toBe('2026-01-15');
    expect(cal.nextDayStart(at('2026-01-15T10:30:00Z'))).toBe(at('2026-01-15T11:00:00Z'));
  });

  it('a zone with no midnight on a DST day (America/Sao_Paulo 2018-11-04)', () => {
    const cal = zonedWorkDayCalendar('America/Sao_Paulo');
    // Midnight 2018-11-04 was skipped: clocks jumped 00:00 -> 01:00 (UTC-3 -> UTC-2).
    const next = cal.nextDayStart(at('2018-11-03T12:00:00Z'));
    expect(next).toBe(at('2018-11-04T03:00:00Z')); // 01:00 -02, the day's first instant
    expect(cal.dayOf(next)).toBe('2018-11-04');
    expect(cal.dayOf(next - 1)).toBe('2018-11-03');
  });
});

describe('resolveSingleDayPlanDefaults (one-item stopwatch plan)', () => {
  const periods = [{ period_id: 'p', start_date: '2026-10-01', end_date: '2026-11-01', timeSheetStatus: 'DRAFT' }];
  const calendar = zonedWorkDayCalendar('UTC');
  const run = (segments: Array<{ started_at: string; ended_at: string | null }>) => {
    const now = Date.parse('2026-12-01T00:00:00Z');
    const plan = toEntryPlan(segments, now, calendar);
    const span = toEntrySpan(segments, now);
    expect(plan).toHaveLength(1);
    const defaults = resolveSingleDayPlanDefaults({
      context: { workItemId: 't', workItemType: 'ticket', workItemName: 'T', startTime: span.start, endTime: span.end },
      planItem: plan[0],
      periods,
      timeZone: 'UTC',
    });
    return { defaults, plan: plan[0], span };
  };

  it('a dropped first day leaves the planned span on day 2, same day', () => {
    // 23:59:45 + 10s (rounds to 0, dropped), then 2h the next day starting 08:00
    const { defaults, plan, span } = run([
      { started_at: '2026-10-05T23:59:45Z', ended_at: '2026-10-05T23:59:55Z' },
      { started_at: '2026-10-06T08:00:00Z', ended_at: '2026-10-06T10:00:00Z' },
    ]);
    expect(span.end.toISOString().slice(0, 10)).not.toBe(span.start.toISOString().slice(0, 10)); // the old toEntrySpan prefill crossed midnight
    expect(defaults!.defaultStartTime).toEqual(plan.start);
    expect(defaults!.defaultEndTime).toEqual(plan.end);
    expect(workDateInTimeZone(defaults!.defaultStartTime, 'UTC')).toBe(workDateInTimeZone(defaults!.defaultEndTime, 'UTC'));
    expect(defaults!.moved).toEqual({ kind: 'none' });
  });

  it('a segment ending just after midnight is capped at 23:59 on its own day', () => {
    const { defaults, plan } = run([{ started_at: '2026-10-05T23:58:40Z', ended_at: '2026-10-06T00:00:20Z' }]);
    expect(defaults!.defaultStartTime.toISOString()).toBe('2026-10-05T23:58:00.000Z');
    expect(defaults!.defaultEndTime.toISOString()).toBe('2026-10-05T23:59:00.000Z');
    expect(defaults!.defaultEndTime).toEqual(plan.end);
    expect(workDateInTimeZone(defaults!.defaultStartTime, 'UTC')).toBe(workDateInTimeZone(defaults!.defaultEndTime, 'UTC'));
  });
});
