import { describe, expect, it } from 'vitest';
import { dateToWallTimeString, zonedWallTimeToUtc } from './dateTimeUtils';

describe('zonedWallTimeToUtc', () => {
  it('converts a wall time using its explicit IANA zone', () => {
    expect(zonedWallTimeToUtc('2026-08-22T09:30', 'America/New_York').toISOString())
      .toBe('2026-08-22T13:30:00.000Z');
  });

  it.each(['2026-03-08T02:30', '2026-11-01T01:30'])(
    'rejects nonexistent or ambiguous New York wall time %s',
    (value) => expect(() => zonedWallTimeToUtc(value, 'America/New_York')).toThrow(/invalid or ambiguous/),
  );
});

describe('dateToWallTimeString', () => {
  it('serializes a Date to a zero-padded local YYYY-MM-DDTHH:mm string', () => {
    // Constructed from local fields so the round trip is independent of the
    // runtime zone (mirrors how the DateTimePicker builds its value).
    const date = new Date(2026, 0, 5, 3, 7); // 2026-01-05 03:07 local
    expect(dateToWallTimeString(date)).toBe('2026-01-05T03:07');
  });

  it('round-trips through zonedWallTimeToUtc for an unambiguous local time', () => {
    const wall = '2026-08-22T09:30';
    const picked = zonedWallTimeToUtc(wall, 'America/New_York');
    // Re-serializing the picker's local Date must reproduce the same wall time.
    expect(dateToWallTimeString(new Date(2026, 7, 22, 9, 30))).toBe(wall);
    expect(picked.toISOString()).toBe('2026-08-22T13:30:00.000Z');
  });
});
