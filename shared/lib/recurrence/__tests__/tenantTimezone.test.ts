/**
 * The engine must not depend on the server process timezone. This file forces the process into
 * Pacific/Auckland (UTC+12/13) and evaluates an America/New_York tenant — the worst-case mismatch
 * from the plan — asserting the same dates and instants regardless.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adjustForNonBusinessDays } from '../adjustForNonBusinessDays';
import { listOccurrenceDates } from '../listOccurrenceDates';
import { recurrenceRuleSchema } from '../rule';
import { toLocalDateString, toZonedInstant } from '../toZonedInstant';
import { buildFallbackBusinessDayCalendar } from '../../businessHours/businessDayCalendar';

const originalTz = process.env.TZ;

describe('process TZ=Pacific/Auckland, tenant America/New_York', () => {
  beforeAll(() => {
    process.env.TZ = 'Pacific/Auckland';
  });
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('actually runs in a different process timezone', () => {
    // January: Auckland is UTC+13, i.e. getTimezoneOffset() === -780
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-780);
  });

  it('enumerates the same nominal dates as any other process timezone', () => {
    const rule = recurrenceRuleSchema.parse({
      frequency: 'monthly', interval: 1, on: { type: 'nthWeekday', nth: 2, weekday: 'tue' },
    });
    expect(listOccurrenceDates(rule, '2026-09-01', { from: '2026-09-01', to: '2026-12-31' })).toEqual([
      '2026-09-08', '2026-10-13', '2026-11-10', '2026-12-08',
    ]);
  });

  it('adjusts business days on calendar dates', () => {
    const rule = recurrenceRuleSchema.parse({ frequency: 'monthly', interval: 1, on: { type: 'dayOfMonth', day: 'last' } });
    const nominal = listOccurrenceDates(rule, '2026-01-01', { from: '2026-01-01', to: '2026-05-31' });
    // Jan 31 Sat, Feb 28 Sat, Mar 31 Tue, Apr 30 Thu, May 31 Sun
    expect(adjustForNonBusinessDays(nominal, 'previous', buildFallbackBusinessDayCalendar()).map((o) => o.due)).toEqual([
      '2026-01-30', '2026-02-27', '2026-03-31', '2026-04-30', '2026-05-29',
    ]);
  });

  it('builds tenant-zone instants independent of the host zone', () => {
    // 08:00 in New York: EST before Mar 8 2026, EDT after.
    expect(toZonedInstant('2026-03-07', '08:00', 'America/New_York').toISOString()).toBe('2026-03-07T13:00:00.000Z');
    expect(toZonedInstant('2026-03-09', '08:00', 'America/New_York').toISOString()).toBe('2026-03-09T12:00:00.000Z');
    // 17:00 NY on Mar 9 is already Mar 10 in Auckland; the tenant-local date must stay Mar 9.
    const due = toZonedInstant('2026-03-09', '17:00', 'America/New_York');
    expect(toLocalDateString(due, 'America/New_York')).toBe('2026-03-09');
    expect(toLocalDateString(due, 'Pacific/Auckland')).toBe('2026-03-10');
  });
});
