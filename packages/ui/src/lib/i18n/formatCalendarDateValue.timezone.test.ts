// Pinned west of UTC before any Date or Intl formatter exists: the bug this
// covers is a quote valid_until of 2026-12-31 (stored as midnight UTC in a
// timestamptz column) rendering as 12/30/2026 in America/New_York.
process.env.TZ = 'America/New_York';

import { describe, expect, it } from 'vitest';
import { countryDateFormat } from '@alga-psa/core/i18n/countryDateFormat';
import { formatCalendarDateValue, toUtcCalendarDateString } from './formatDateValue';

const DE = countryDateFormat('DE');
const PADDED: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit' };

describe('formatCalendarDateValue (TZ=America/New_York)', () => {
  it('keeps the stored day for a midnight-UTC ISO string', () => {
    expect(formatCalendarDateValue('2026-12-31T00:00:00.000Z', 'en', PADDED)).toBe('12/31/2026');
  });

  it('keeps the stored day for a midnight-UTC Date', () => {
    expect(formatCalendarDateValue(new Date(Date.UTC(2026, 11, 31)), 'en', PADDED)).toBe('12/31/2026');
  });

  it('keeps the stored day for a postgres-style offset string', () => {
    expect(formatCalendarDateValue('2026-12-31 00:00:00+00', 'en', PADDED)).toBe('12/31/2026');
  });

  it('passes a date-only string through unchanged', () => {
    expect(formatCalendarDateValue('2026-12-31', 'en', PADDED)).toBe('12/31/2026');
  });

  it('writes the country shape and the language month name', () => {
    expect(formatCalendarDateValue('2026-12-31T00:00:00Z', 'de', PADDED, DE)).toBe('31.12.2026');
    expect(
      formatCalendarDateValue('2026-12-31T00:00:00Z', 'de', { year: 'numeric', month: 'long', day: 'numeric' }, DE),
    ).toBe('31. Dezember 2026');
  });

  it('maps empty and unparseable input to null', () => {
    expect(toUtcCalendarDateString(null)).toBeNull();
    expect(toUtcCalendarDateString('')).toBeNull();
    expect(toUtcCalendarDateString('not a date')).toBeNull();
  });
});
