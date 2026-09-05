/**
 * Behavioral UTC-boundary coverage for Usage Tracking's plain-date handling.
 *
 * The regression these guard: usage dates were initialized with
 * `new Date().toISOString()` and rendered with `new Date(value).toLocaleDateString()`,
 * so the day the operator picked silently shifted for any viewer whose timezone
 * straddled the UTC date boundary — a record for Sep 1 shown as Aug 31 in the
 * Americas. The calendar day must survive round-trip and display unchanged in
 * every timezone.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { dateFromString } from '../../ui/src/lib/dateInput';
import {
  todayUsageDate,
  usageDateFromStored,
  usageDateToStored,
} from '../src/lib/usageDate';

const ORIGINAL_TZ = process.env.TZ;

// Timezones on both sides of UTC, including a fractional offset, so a shift in
// either direction is caught.
const TIMEZONES = ['UTC', 'America/Los_Angeles', 'Australia/Sydney', 'Asia/Kolkata'];

function withTZ(tz: string, fn: () => void): void {
  process.env.TZ = tz;
  try {
    fn();
  } finally {
    process.env.TZ = ORIGINAL_TZ;
  }
}

/** The local calendar components of a Date, i.e. what the operator reads. */
function localYMD(date: Date | undefined): string {
  if (!date) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

describe('usageDate plain-calendar-date handling across the UTC boundary', () => {
  afterEach(() => {
    process.env.TZ = ORIGINAL_TZ;
  });

  it('recovers the stored calendar day unchanged in every timezone', () => {
    const storedIso = '2026-09-01T00:00:00.000Z';
    for (const tz of TIMEZONES) {
      withTZ(tz, () => {
        expect(usageDateFromStored(storedIso)).toBe('2026-09-01');
        // The pg driver materializes the timestamptz as a Date; that path must
        // recover the same day, not a toLocaleDateString-style shift.
        expect(usageDateFromStored(new Date(storedIso))).toBe('2026-09-01');
      });
    }
  });

  it('renders the picked day (not a UTC-shifted day) in every timezone', () => {
    const storedIso = '2026-09-01T00:00:00.000Z';
    for (const tz of TIMEZONES) {
      withTZ(tz, () => {
        // The display path: stored -> plain -> local-midnight Date. The shown
        // day must equal the picked day regardless of viewer timezone.
        const shown = dateFromString(usageDateFromStored(storedIso));
        expect(localYMD(shown)).toBe('2026-09-01');
      });
    }
  });

  it('round-trips a picked calendar date through the canonical stored form', () => {
    for (const tz of TIMEZONES) {
      withTZ(tz, () => {
        const stored = usageDateToStored('2026-09-01');
        expect(stored).toBe('2026-09-01T00:00:00.000Z');
        expect(usageDateFromStored(stored)).toBe('2026-09-01');
      });
    }
  });

  it("defaults to the operator's local calendar day, not the UTC day", () => {
    // 2026-09-02 05:30 UTC is still 2026-09-01 in Los Angeles (22:30) — the
    // default must follow the wall calendar, so an evening entry does not jump
    // to tomorrow.
    withTZ('America/Los_Angeles', () => {
      const eveningInstant = new Date('2026-09-02T05:30:00.000Z');
      expect(todayUsageDate(eveningInstant)).toBe('2026-09-01');
    });
    // ...and east of UTC the same instant is already 2026-09-02 locally.
    withTZ('Australia/Sydney', () => {
      const eveningInstant = new Date('2026-09-02T05:30:00.000Z');
      expect(todayUsageDate(eveningInstant)).toBe('2026-09-02');
    });
  });

  it('treats empty and cleared values as empty, never the epoch', () => {
    expect(usageDateFromStored('')).toBe('');
    expect(usageDateFromStored(null)).toBe('');
    expect(usageDateFromStored(undefined)).toBe('');
    expect(usageDateToStored('')).toBe('');
    expect(usageDateToStored(null)).toBe('');
  });
});
