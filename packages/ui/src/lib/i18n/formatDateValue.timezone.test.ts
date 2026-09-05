// TZ must be pinned before anything constructs a Date or Intl formatter: this
// suite exists to prove date-only values do NOT shift in a timezone west of
// UTC (the smoke repro: invoice_date 2026-09-30 rendered 29/09/2026 in
// America/New_York).
process.env.TZ = 'America/New_York';

import { describe, expect, it } from 'vitest';
import { formatDateValue, isDateOnlyString } from './formatDateValue';

describe('formatDateValue date-only handling (TZ=America/New_York)', () => {
  it('runs under the intended ambient timezone', () => {
    expect(new Intl.DateTimeFormat('en').resolvedOptions().timeZone).toBe(
      'America/New_York',
    );
  });

  it('renders a date-only string as the written calendar day in en-AU', () => {
    expect(formatDateValue('2026-09-30', 'en-AU')).toBe('30/09/2026');
  });

  it('renders a date-only string as the written calendar day in en', () => {
    expect(formatDateValue('2026-09-30', 'en')).toBe('9/30/2026');
  });

  it('preserves the calendar day even when caller options carry a timezone', () => {
    expect(
      formatDateValue('2026-09-30', 'en-AU', { timeZone: 'America/New_York' }),
    ).toBe('30/09/2026');
  });

  it('handles month boundaries: the 1st does not become the prior month', () => {
    expect(formatDateValue('2026-10-01', 'en-AU')).toBe('01/10/2026');
  });

  it('handles leap day', () => {
    expect(formatDateValue('2028-02-29', 'en-AU')).toBe('29/02/2028');
  });

  it('still formats datetime strings as instants in the viewer timezone', () => {
    // Midnight UTC is the prior evening in New York — correct for an instant.
    expect(formatDateValue('2026-09-30T00:00:00.000Z', 'en-AU')).toBe(
      '29/09/2026',
    );
  });

  it('still formats Date objects as instants in the viewer timezone', () => {
    expect(formatDateValue(new Date('2026-09-30T00:00:00.000Z'), 'en-AU')).toBe(
      '29/09/2026',
    );
  });

  it('recognizes only bare YYYY-MM-DD strings as date-only', () => {
    expect(isDateOnlyString('2026-09-30')).toBe(true);
    expect(isDateOnlyString('2026-09-30T00:00:00Z')).toBe(false);
    expect(isDateOnlyString('2026-9-30')).toBe(false);
    expect(isDateOnlyString(new Date('2026-09-30'))).toBe(false);
  });
});
