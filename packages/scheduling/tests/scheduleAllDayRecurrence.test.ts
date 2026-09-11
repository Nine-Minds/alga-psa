import { describe, expect, it } from 'vitest';
import type { IScheduleEntry, IHoliday } from '@alga-psa/types';
import { generateOccurrences } from '../../../shared/utils/recurrenceUtils';

function entryFor(start: string, end: string, overrides: Partial<IScheduleEntry> = {}): IScheduleEntry {
  const scheduledStart = new Date(`${start}T00:00:00Z`);
  return {
    entry_id: 'all-day-master', tenant: 'fixture-tenant', title: 'All-day recurring',
    scheduled_start: scheduledStart, scheduled_end: new Date(scheduledStart.getTime() + 86400000),
    work_item_type: 'ad_hoc', status: 'scheduled', is_all_day: true,
    recurrence_pattern: { frequency: 'daily', interval: 1, startDate: scheduledStart, endDate: new Date(`${end}T00:00:00Z`) },
    ...overrides,
  } as IScheduleEntry;
}

for (const timezone of ['UTC', 'Europe/Berlin', 'America/Los_Angeles']) {
  describe(timezone, () => {
    function inTimezone(run: () => void) {
      const previous = process.env.TZ;
      process.env.TZ = timezone;
      try { run(); } finally {
        if (previous === undefined) delete process.env.TZ;
        else process.env.TZ = previous;
      }
    }

    it.each([
      ['2026-10-24', '2026-10-27', ['2026-10-25', '2026-10-26', '2026-10-27']],
      ['2026-03-28', '2026-03-31', ['2026-03-29', '2026-03-30', '2026-03-31']],
      ['2026-10-31', '2026-11-03', ['2026-11-01', '2026-11-02', '2026-11-03']],
      ['2026-03-07', '2026-03-10', ['2026-03-08', '2026-03-09', '2026-03-10']],
    ])('retains UTC-midnight all-day dates across DST from %s', (start, end, dates) => inTimezone(() => {
      const entry = entryFor(start, end);
      const actual = generateOccurrences(entry, new Date(`${start}T00:00:00Z`), new Date(`${end}T23:59:59Z`));
      expect(actual.map(date => date.toISOString())).toEqual(dates.map(date => `${date}T00:00:00.000Z`));
    }));

    it('uses UTC dates for all-day weekdays, exceptions, holidays and range boundaries', () => inTimezone(() => {
      const entry = entryFor('2026-10-23', '2026-11-10');
      entry.recurrence_pattern = { ...entry.recurrence_pattern!, frequency: 'weekly', daysOfWeek: [0],
        exceptions: [new Date('2026-11-02T00:00:00Z')] };
      const holidays = [{ holiday_date: '2026-10-26', is_recurring: false }] as IHoliday[];
      const occurrences = generateOccurrences(entry, new Date('2026-10-24T00:00:00Z'), new Date('2026-11-09T23:59:59Z'), { holidays });
      expect(occurrences.map(date => date.toISOString())).toEqual(['2026-11-09T00:00:00.000Z']);
    }));

    it('retains existing local-clock semantics for explicitly timed entries', () => inTimezone(() => {
      const start = new Date(2026, 9, 24, 9, 30);
      const end = new Date(2026, 9, 27, 23, 59);
      const entry = entryFor('2026-10-24', '2026-10-27', {
        is_all_day: false, scheduled_start: start,
        recurrence_pattern: { frequency: 'daily', interval: 1, startDate: start, endDate: end },
      });
      const occurrences = generateOccurrences(entry, start, end);
      expect(occurrences.length).toBeGreaterThan(0);
      expect(occurrences.every(date => date.getHours() === 9 && date.getMinutes() === 30)).toBe(true);
      expect(generateOccurrences({ ...entry, is_all_day: undefined }, start, end)).toEqual(occurrences);
    }));
  });
}
