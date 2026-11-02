import { describe, expect, it } from 'vitest';
import { dbDateObjectToDateOnly, isDbLocalMidnightDate } from '../dbDateOnly';

describe('dbDateOnly', () => {
  it('reads a local-midnight date-column value as its stored calendar day', () => {
    const hydrated = new Date(2025, 10, 1); // how node-postgres hydrates DATE '2025-11-01'
    expect(dbDateObjectToDateOnly(hydrated)).toBe('2025-11-01');
  });

  it('reads a UTC-midnight Date in UTC', () => {
    const utc = new Date('2025-11-15T00:00:00.000Z');
    expect(isDbLocalMidnightDate(utc)).toBe(false);
    expect(dbDateObjectToDateOnly(utc)).toBe('2025-11-15');
  });

  it('does not treat a mid-day instant as a date-column value', () => {
    const local = new Date(2025, 10, 1, 13, 30);
    expect(isDbLocalMidnightDate(local)).toBe(false);
  });

  it('flags local midnight only when the server is not on UTC', () => {
    const hydrated = new Date(2025, 10, 1);
    expect(isDbLocalMidnightDate(hydrated)).toBe(hydrated.getTimezoneOffset() !== 0);
  });
});
