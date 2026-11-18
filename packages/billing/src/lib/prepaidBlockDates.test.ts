import { describe, expect, it } from 'vitest';
import {
  computePrepaidBlockAnniversaryDate,
  computePrepaidBlockExpirationDate,
  dateOnlyToUtcMidnightIso,
  toBusinessDate,
  toDateOnly,
} from './prepaidBlockDates';

describe('prepaid block date arithmetic (plan D6)', () => {
  it('expiration is the last usable day: invoice date + N months - 1 day', () => {
    expect(computePrepaidBlockExpirationDate('2026-03-15', 12)).toBe('2027-03-14');
    expect(computePrepaidBlockExpirationDate('2026-01-01', 1)).toBe('2026-01-31');
  });

  it('anniversary is invoice date + N months', () => {
    expect(computePrepaidBlockAnniversaryDate('2026-03-15', 12)).toBe('2027-03-15');
  });

  it('clamps to the end of shorter months', () => {
    expect(computePrepaidBlockAnniversaryDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(computePrepaidBlockExpirationDate('2026-01-31', 1)).toBe('2026-02-27');
    expect(computePrepaidBlockAnniversaryDate('2027-02-28', 12)).toBe('2028-02-28');
    expect(computePrepaidBlockExpirationDate('2027-02-28', 12)).toBe('2028-02-27');
  });

  it('handles leap days', () => {
    expect(computePrepaidBlockExpirationDate('2028-02-29', 12)).toBe('2029-02-27');
  });

  it('accepts timestamps and Date values, using the calendar date only', () => {
    expect(computePrepaidBlockExpirationDate('2026-03-15T23:59:59.000Z', 6)).toBe('2026-09-14');
    expect(computePrepaidBlockExpirationDate(new Date('2026-03-15T00:00:00.000Z'), 6)).toBe('2026-09-14');
  });

  it('null/undefined expiry months means the block never expires', () => {
    expect(computePrepaidBlockExpirationDate('2026-03-15', null)).toBeNull();
    expect(computePrepaidBlockExpirationDate('2026-03-15', undefined)).toBeNull();
  });

  it('rejects non-positive or fractional months', () => {
    expect(() => computePrepaidBlockExpirationDate('2026-03-15', 0)).toThrow();
    expect(() => computePrepaidBlockAnniversaryDate('2026-03-15', 1.5)).toThrow();
  });
});

describe('prepaid block date-only helpers (server-zone independent)', () => {
  it('reads strings and UTC-midnight / local-midnight Dates as the same calendar day', () => {
    expect(toDateOnly('2026-10-13')).toBe('2026-10-13');
    expect(toDateOnly('2026-10-13T04:00:00.000Z')).toBe('2026-10-13');
    expect(toDateOnly(new Date('2026-10-13T00:00:00Z'))).toBe('2026-10-13');
    // pg hydrates a `date` column as LOCAL midnight; whatever the host zone, it is that day.
    expect(toDateOnly(new Date(2026, 9, 13))).toBe('2026-10-13');
    expect(toDateOnly(null)).toBeNull();
    expect(toDateOnly('garbage')).toBeNull();
  });

  it('normalizes a date-only value to UTC midnight regardless of host zone', () => {
    expect(dateOnlyToUtcMidnightIso('2026-10-13')).toBe('2026-10-13T00:00:00Z');
    expect(new Date(dateOnlyToUtcMidnightIso('2026-10-13')).getUTCHours()).toBe(0);
  });

  it('takes the calendar day of an instant in the business time zone, not UTC', () => {
    // 20:00 EDT on 10/13 is already 10/14 in UTC.
    expect(toBusinessDate('2026-10-14T00:00:00Z', 'America/New_York')).toBe('2026-10-13');
    expect(toBusinessDate(new Date('2026-10-14T00:00:00Z'), 'UTC')).toBe('2026-10-14');
  });
});
