import { describe, expect, it } from 'vitest';
import { zonedWallTimeToUtc } from './dateTimeUtils';

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
