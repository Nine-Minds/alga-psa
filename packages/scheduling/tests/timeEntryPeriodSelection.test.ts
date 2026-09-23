import { describe, expect, it } from 'vitest';
import {
  dateOnlyToLocalDate,
  instantAtZonedTime,
  isEditableSheetStatus,
  isWithinPeriod,
  periodLastInclusiveDay,
  resolveEntryDefaults,
  workDateInTimeZone,
} from '../src/lib/timeEntryPeriodSelection';

const weeklyPeriod = { start_date: '2026-09-07', end_date: '2026-09-14' };

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

  describe('resolveEntryDefaults', () => {
    it('keeps context timestamps that both fall inside the period', () => {
      const start = new Date('2026-09-08T13:00:00Z');
      const end = new Date('2026-09-08T14:30:00Z');
      const resolved = resolveEntryDefaults({
        context: { startTime: start, endTime: end },
        period: weeklyPeriod,
        timeZone: 'UTC',
      });
      expect(resolved.adjusted).toBe(false);
      expect(resolved.source).toBe('context');
      expect(resolved.defaultStartTime).toEqual(start);
      expect(resolved.defaultEndTime).toEqual(end);
    });

    it('rebases out-of-period context timestamps to the period first day at 08:00', () => {
      const resolved = resolveEntryDefaults({
        context: {
          startTime: new Date('2026-08-01T09:00:00Z'),
          endTime: new Date('2026-08-01T10:00:00Z'),
        },
        period: weeklyPeriod,
        timeZone: 'UTC',
      });
      expect(resolved.adjusted).toBe(true);
      expect(resolved.source).toBe('context');
      expect(resolved.defaultStartTime.toISOString()).toBe('2026-09-07T08:00:00.000Z');
      expect(resolved.defaultEndTime.toISOString()).toBe('2026-09-07T09:00:00.000Z');
    });

    it('rebases a timer whose recorded span predates the period', () => {
      const resolved = resolveEntryDefaults({
        context: { elapsedTime: 3600 },
        period: { start_date: '2020-01-01', end_date: '2020-01-08' },
        timeZone: 'UTC',
      });
      expect(resolved.source).toBe('timer');
      expect(resolved.adjusted).toBe(true);
      expect(resolved.defaultStartTime.toISOString()).toBe('2020-01-01T08:00:00.000Z');
      expect(resolved.defaultEndTime.toISOString()).toBe('2020-01-01T09:00:00.000Z');
    });

    it('always supplies explicit defaults so ad-hoc/schedule rows cannot override the period', () => {
      const resolved = resolveEntryDefaults({
        context: {},
        period: weeklyPeriod,
        timeZone: 'UTC',
      });
      expect(resolved.source).toBe('none');
      expect(resolved.adjusted).toBe(false);
      expect(resolved.defaultStartTime.toISOString()).toBe('2026-09-07T08:00:00.000Z');
      expect(resolved.defaultEndTime.toISOString()).toBe('2026-09-07T09:00:00.000Z');
    });

    it('uses the subject timezone to place the fallback 08:00 on the period first day', () => {
      const resolved = resolveEntryDefaults({
        context: {},
        period: weeklyPeriod,
        timeZone: 'America/New_York',
      });
      expect(resolved.defaultStartTime.toISOString()).toBe('2026-09-07T12:00:00.000Z');
      expect(workDateInTimeZone(resolved.defaultStartTime, 'America/New_York')).toBe('2026-09-07');
    });

    it('treats a date-only string as local midnight, not UTC', () => {
      const date = dateOnlyToLocalDate('2026-09-07');
      expect(date.getFullYear()).toBe(2026);
      expect(date.getMonth()).toBe(8);
      expect(date.getDate()).toBe(7);
    });
  });
});
