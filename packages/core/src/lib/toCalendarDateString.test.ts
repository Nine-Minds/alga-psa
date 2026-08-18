import { afterAll, describe, expect, it } from 'vitest';
import { toCalendarDateString } from './dateTimeUtils';

// TZ is process-global and vitest isolation is module-level only: without a
// restore, the last zone set here (Europe/Berlin) leaks into every later file
// in the shared fork and shifts their dates (seen as CI-only recurrence and
// invoice-preview failures).
const originalTz = process.env.TZ;
afterAll(() => {
  if (originalTz === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = originalTz;
  }
});

// Regression tests for the hour-block expiration date persistence bug: a
// DatePicker selection of calendar date 2026-08-31 (a local-midnight Date in
// the browser) used to be serialized via toISOString() and persisted as
// 2026-08-30 in UTC+2 timezones. The conversion is process-timezone-dependent,
// so every test sets TZ explicitly and guards that Node actually honored it by
// asserting the process offset before asserting on dates.

function pickerLocalMidnightFor(isoDateOnly: string): Date {
  const [y, m, d] = isoDateOnly.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function assertTz(zone: string, expectedOffsetMinutes: number) {
  process.env.TZ = zone;
  expect(new Date().getTimezoneOffset(), `TZ=${zone} did not take effect`).toBe(expectedOffsetMinutes);
}

describe('toCalendarDateString — DatePicker Date → YYYY-MM-DD', () => {
  it('keeps the picked calendar day in Europe/Berlin (UTC+2 summer) — the reported failure', () => {
    assertTz('Europe/Berlin', -120);
    const picked = pickerLocalMidnightFor('2026-08-31');
    expect(picked.toISOString()).toBe('2026-08-30T22:00:00.000Z');
    expect(toCalendarDateString(picked)).toBe('2026-08-31');
  });

  it('keeps the picked calendar day in Pacific/Kiritimati (UTC+14) — opposite-direction drift', () => {
    assertTz('Pacific/Kiritimati', -840);
    const picked = pickerLocalMidnightFor('2026-08-31');
    expect(picked.toISOString()).toBe('2026-08-30T10:00:00.000Z');
    expect(toCalendarDateString(picked)).toBe('2026-08-31');
  });

  it('keeps the picked calendar day in UTC and in a negative-offset zone', () => {
    assertTz('UTC', 0);
    expect(toCalendarDateString(pickerLocalMidnightFor('2026-08-31'))).toBe('2026-08-31');
    assertTz('America/New_York', 240);
    expect(toCalendarDateString(pickerLocalMidnightFor('2026-08-31'))).toBe('2026-08-31');
  });

  it('survives a month boundary and a leap-ish edge in Berlin', () => {
    assertTz('Europe/Berlin', -120);
    expect(toCalendarDateString(pickerLocalMidnightFor('2026-09-01'))).toBe('2026-09-01');
    expect(toCalendarDateString(pickerLocalMidnightFor('2026-12-31'))).toBe('2026-12-31');
    expect(toCalendarDateString(pickerLocalMidnightFor('2027-01-01'))).toBe('2027-01-01');
  });

  it('reads a non-midnight local Date (e.g. the noon-anchored display Date) as its local day', () => {
    assertTz('Europe/Berlin', -120);
    expect(toCalendarDateString(new Date(2026, 7, 31, 12, 0, 0))).toBe('2026-08-31');
  });
});

describe('toCalendarDateString — string / PlainDate / null normalization', () => {
  it('passes a date-only string through byte-for-byte after validation', () => {
    expect(toCalendarDateString('2026-08-31')).toBe('2026-08-31');
    expect(toCalendarDateString('2027-02-28')).toBe('2027-02-28');
  });

  it('maps null, undefined and empty string to null', () => {
    expect(toCalendarDateString(null)).toBeNull();
    expect(toCalendarDateString(undefined)).toBeNull();
    expect(toCalendarDateString('')).toBeNull();
  });

  it('throws on invalid date-only strings instead of silently nulling', () => {
    expect(() => toCalendarDateString('2026-13-99')).toThrow();
    expect(() => toCalendarDateString('not-a-date')).toThrow();
  });

  it('resolves full ISO instants via their UTC calendar date (legacy input shape)', () => {
    expect(toCalendarDateString('2026-08-31T12:00:00.000Z')).toBe('2026-08-31');
    expect(toCalendarDateString('2026-08-31T00:00:00.000Z')).toBe('2026-08-31');
  });
});
