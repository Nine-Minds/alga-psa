import { describe, expect, it } from 'vitest';
import { normalizeDateValue, normalizeTimeValue, toBrowserDate } from './dateUtils';

describe('appointments/dateUtils', () => {
  describe('normalizeDateValue', () => {
    it('returns null for nullish input', () => {
      expect(normalizeDateValue(null)).toBeNull();
      expect(normalizeDateValue(undefined)).toBeNull();
      expect(normalizeDateValue('')).toBeNull();
    });

    it('extracts YYYY-MM-DD from a Date instance', () => {
      const d = new Date('2026-01-15T12:34:56Z');
      expect(normalizeDateValue(d)).toBe('2026-01-15');
    });

    it('truncates an ISO-like string to YYYY-MM-DD', () => {
      expect(normalizeDateValue('2026-04-29T08:00:00Z')).toBe('2026-04-29');
      expect(normalizeDateValue('2026-04-29')).toBe('2026-04-29');
    });

    it('returns null for non-string non-Date input', () => {
      expect(normalizeDateValue(42)).toBeNull();
      expect(normalizeDateValue({})).toBeNull();
    });
  });

  describe('normalizeTimeValue', () => {
    it('truncates a PG time string to HH:MM', () => {
      expect(normalizeTimeValue('11:30:00')).toBe('11:30');
      expect(normalizeTimeValue('07:05')).toBe('07:05');
    });

    it('returns null for nullish or non-string input', () => {
      expect(normalizeTimeValue(null)).toBeNull();
      expect(normalizeTimeValue(undefined)).toBeNull();
      expect(normalizeTimeValue(42)).toBeNull();
    });
  });

  describe('toBrowserDate', () => {
    it('returns null when either part is missing', () => {
      expect(toBrowserDate(null, '11:00', 'UTC')).toBeNull();
      expect(toBrowserDate('2026-04-29', null, 'UTC')).toBeNull();
    });

    it('combines a UTC date+time into the matching epoch instant', () => {
      const dt = toBrowserDate('2026-04-29', '08:30', 'UTC');
      expect(dt).not.toBeNull();
      // 08:30 UTC on 2026-04-29
      expect(dt!.toISOString()).toBe('2026-04-29T08:30:00.000Z');
    });

    it('respects the supplied IANA timezone', () => {
      // 09:00 in America/New_York on 2026-04-29 = 13:00 UTC
      const dt = toBrowserDate('2026-04-29', '09:00', 'America/New_York');
      expect(dt!.toISOString()).toBe('2026-04-29T13:00:00.000Z');
    });

    it('falls back to UTC when timezone is missing', () => {
      const dt = toBrowserDate('2026-04-29', '00:00', null);
      expect(dt!.toISOString()).toBe('2026-04-29T00:00:00.000Z');
    });
  });
});
