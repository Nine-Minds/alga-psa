import { describe, expect, it } from 'vitest';
import { toCalendarDateStringInTimeZone } from './dateTimeUtils';

// Regression tests for the hour-block expiration boundary invariant (29.8.18
// mitigation round): "today" for expiration eligibility is the calendar date in
// the TENANT's IANA timezone, independent of the worker host's timezone. A UTC
// worker and a Berlin worker must agree on the same tenant's calendar day.
//
// The helper derives the day via Intl.DateTimeFormat with an explicit timeZone,
// so unlike toCalendarDateString it must NOT depend on process.env.TZ. Every
// test pins the process TZ to a zone that disagrees with the asserted target
// zone and asserts the exact same result — proving host-TZ independence.

function assertTz(zone: string, expectedOffsetMinutes: number) {
  process.env.TZ = zone;
  expect(new Date().getTimezoneOffset(), `TZ=${zone} did not take effect`).toBe(expectedOffsetMinutes);
}

describe('toCalendarDateStringInTimeZone', () => {
  it('is host-TZ independent: Berlin result identical from a UTC worker and a Kiritimati worker', () => {
    const instant = new Date('2026-08-31T22:00:00.000Z'); // 2026-09-01 00:00 +02:00
    assertTz('UTC', 0);
    expect(toCalendarDateStringInTimeZone(instant, 'Europe/Berlin')).toBe('2026-09-01');
    assertTz('Pacific/Kiritimati', -840);
    expect(toCalendarDateStringInTimeZone(instant, 'Europe/Berlin')).toBe('2026-09-01');
    assertTz('America/New_York', 240);
    expect(toCalendarDateStringInTimeZone(instant, 'Europe/Berlin')).toBe('2026-09-01');
  });

  it('reads the UTC calendar day across a day boundary', () => {
    assertTz('Europe/Berlin', -120); // hostile worker zone
    expect(toCalendarDateStringInTimeZone(new Date('2026-08-31T22:00:00.000Z'), 'UTC')).toBe('2026-08-31');
    expect(toCalendarDateStringInTimeZone(new Date('2026-08-31T23:59:59.999Z'), 'UTC')).toBe('2026-08-31');
    expect(toCalendarDateStringInTimeZone(new Date('2026-09-01T00:00:00.000Z'), 'UTC')).toBe('2026-09-01');
  });

  it('reads the Berlin calendar day across a day boundary (UTC+2 summer)', () => {
    assertTz('UTC', 0); // hostile worker zone
    expect(toCalendarDateStringInTimeZone(new Date('2026-08-31T21:59:00.000Z'), 'Europe/Berlin')).toBe('2026-08-31');
    expect(toCalendarDateStringInTimeZone(new Date('2026-08-31T22:00:00.000Z'), 'Europe/Berlin')).toBe('2026-09-01');
    expect(toCalendarDateStringInTimeZone(new Date('2026-09-01T21:59:00.000Z'), 'Europe/Berlin')).toBe('2026-09-01');
    expect(toCalendarDateStringInTimeZone(new Date('2026-09-01T22:00:00.000Z'), 'Europe/Berlin')).toBe('2026-09-02');
  });

  it('reads the Kiritimati calendar day across a day boundary (UTC+14)', () => {
    assertTz('UTC', 0); // hostile worker zone
    expect(toCalendarDateStringInTimeZone(new Date('2026-08-30T09:59:00.000Z'), 'Pacific/Kiritimati')).toBe('2026-08-30');
    expect(toCalendarDateStringInTimeZone(new Date('2026-08-30T10:00:00.000Z'), 'Pacific/Kiritimati')).toBe('2026-08-31');
  });

  it('reads the negative-offset calendar day across a day boundary (America/New_York)', () => {
    assertTz('UTC', 0); // hostile worker zone
    expect(toCalendarDateStringInTimeZone(new Date('2026-09-01T03:59:00.000Z'), 'America/New_York')).toBe('2026-08-31');
    expect(toCalendarDateStringInTimeZone(new Date('2026-09-01T04:00:00.000Z'), 'America/New_York')).toBe('2026-09-01');
  });

  it('pads months and days to two digits', () => {
    assertTz('UTC', 0);
    expect(toCalendarDateStringInTimeZone(new Date('2026-01-05T12:00:00.000Z'), 'UTC')).toBe('2026-01-05');
    expect(toCalendarDateStringInTimeZone(new Date('2026-12-31T12:00:00.000Z'), 'UTC')).toBe('2026-12-31');
  });

  it('throws on an invalid timezone string (callers pre-validate)', () => {
    assertTz('UTC', 0);
    expect(() => toCalendarDateStringInTimeZone(new Date(), 'Not/AZone')).toThrow();
    expect(() => toCalendarDateStringInTimeZone(new Date(), 'garbage')).toThrow();
  });
});
