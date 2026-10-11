import { describe, expect, it } from 'vitest';
import { toLocalDateString, toZonedInstant } from '../toZonedInstant';

const iso = (d: Date) => d.toISOString();

describe('toZonedInstant', () => {
  it('converts wall-clock time in the given zone (standard and daylight offsets)', () => {
    expect(iso(toZonedInstant('2026-03-07', '08:00', 'America/New_York'))).toBe('2026-03-07T13:00:00.000Z'); // EST
    expect(iso(toZonedInstant('2026-03-09', '08:00', 'America/New_York'))).toBe('2026-03-09T12:00:00.000Z'); // EDT
    expect(iso(toZonedInstant('2026-07-01', '17:00', 'Europe/Stockholm'))).toBe('2026-07-01T15:00:00.000Z'); // CEST
  });

  describe('America/New_York', () => {
    it('spring-forward gap: 02:30 does not exist and resolves to 03:30 EDT', () => {
      expect(iso(toZonedInstant('2026-03-08', '02:30', 'America/New_York'))).toBe('2026-03-08T07:30:00.000Z');
    });

    it('fall-back overlap: 01:30 occurs twice and resolves to the earlier (EDT) instant', () => {
      expect(iso(toZonedInstant('2026-11-01', '01:30', 'America/New_York'))).toBe('2026-11-01T05:30:00.000Z');
    });
  });

  describe('Europe/Stockholm', () => {
    it('spring-forward gap: 02:30 does not exist and resolves to 03:30 CEST', () => {
      expect(iso(toZonedInstant('2026-03-29', '02:30', 'Europe/Stockholm'))).toBe('2026-03-29T01:30:00.000Z');
    });

    it('fall-back overlap: 02:30 occurs twice and resolves to the earlier (CEST) instant', () => {
      expect(iso(toZonedInstant('2026-10-25', '02:30', 'Europe/Stockholm'))).toBe('2026-10-25T00:30:00.000Z');
    });
  });

  it('rejects malformed times', () => {
    expect(() => toZonedInstant('2026-03-08', '8:00', 'UTC')).toThrow(/HH:MM/);
    expect(() => toZonedInstant('2026-03-08', '24:00', 'UTC')).toThrow(/HH:MM/);
    expect(() => toZonedInstant('2026-03-08', '12:60', 'UTC')).toThrow(/HH:MM/);
  });

  it('rejects invalid dates and unknown zones', () => {
    expect(() => toZonedInstant('2026-02-30', '08:00', 'UTC')).toThrow();
    expect(() => toZonedInstant('2026-03-08', '08:00', 'Mars/Olympus')).toThrow();
  });
});

describe('toLocalDateString', () => {
  it('reads the calendar date in the target zone, not the host zone', () => {
    const instant = new Date('2026-03-08T03:30:00.000Z'); // still Mar 7 evening in New York
    expect(toLocalDateString(instant, 'America/New_York')).toBe('2026-03-07');
    expect(toLocalDateString(instant, 'Pacific/Auckland')).toBe('2026-03-08');
    expect(toLocalDateString(instant, 'UTC')).toBe('2026-03-08');
  });
});
