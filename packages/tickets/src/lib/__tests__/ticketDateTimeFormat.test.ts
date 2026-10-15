import { describe, expect, it } from 'vitest';
import { countryDateFormat, SYSTEM_DATE_FORMAT } from '@alga-psa/core/i18n/countryDateFormat';

import { formatTicketDateTime, formatTicketRelativeToNow } from '../ticketDateTimeFormat';

const TS = '2026-07-06T16:43:00.000Z';
const TZ = 'UTC';

describe('formatTicketDateTime', () => {
  it('takes digit order and separator from the country, not the language', () => {
    for (const locale of ['en', 'fr', 'nl', 'de']) {
      expect(formatTicketDateTime(TS, locale, TZ, countryDateFormat('AU'))).toContain('06/07/2026');
      expect(formatTicketDateTime(TS, locale, TZ, countryDateFormat('US'))).toContain('07/06/2026');
      expect(formatTicketDateTime(TS, locale, TZ, countryDateFormat('DE'))).toContain('06.07.2026');
    }
  });

  it('takes the clock from the country, not the language', () => {
    // fr is a 24h language; a US tenant still reads a meridiem.
    expect(formatTicketDateTime(TS, 'fr', TZ, countryDateFormat('US'))).toMatch(/\b(AM|PM)\b/);
    // en is a 12h language; a GB tenant still reads 24h.
    expect(formatTicketDateTime(TS, 'en', TZ, countryDateFormat('GB'))).toContain('16:43');
    expect(formatTicketDateTime(TS, 'en', TZ, countryDateFormat('GB'))).not.toMatch(/\b(AM|PM)\b/);
  });

  it('falls back to the fixed system default with no country resolved', () => {
    expect(formatTicketDateTime(TS, 'fr', TZ)).toBe(
      formatTicketDateTime(TS, 'fr', TZ, SYSTEM_DATE_FORMAT)
    );
    expect(formatTicketDateTime(TS, 'fr', TZ)).toContain('07/06/2026');
  });

  it('writes the weekday name in the app language when the tenant asked for one', () => {
    const withWeekday = formatTicketDateTime(TS, 'fr', TZ, countryDateFormat('FR'), true);
    expect(withWeekday).toMatch(/^lun/);
    expect(withWeekday).toContain('06/07/2026');

    expect(formatTicketDateTime(TS, 'en', TZ, countryDateFormat('FR'), true)).toMatch(/^Mon/);
    expect(formatTicketDateTime(TS, 'fr', TZ, countryDateFormat('FR'))).not.toMatch(/^lun/);
  });

  it('returns the input unchanged when it is not a date', () => {
    expect(formatTicketDateTime('not-a-date', 'fr', TZ)).toBe('not-a-date');
  });
});

describe('formatTicketRelativeToNow', () => {
  it('translates the relative age and supplies the suffix', () => {
    const anHourAgo = new Date(Date.now() - 3600_000);
    expect(formatTicketRelativeToNow(anHourAgo, 'en')).toBe('about 1 hour ago');
    expect(formatTicketRelativeToNow(anHourAgo, 'fr')).toBe('il y a environ 1 heure');
    expect(formatTicketRelativeToNow(anHourAgo, 'nl')).toBe('ongeveer 1 uur geleden');
  });

  it('never leaves an English "ago" in a translated locale', () => {
    const aWhileAgo = new Date(Date.now() - 40 * 86400_000);
    for (const locale of ['fr', 'nl', 'de', 'it', 'pl', 'pt', 'es']) {
      expect(formatTicketRelativeToNow(aWhileAgo, locale)).not.toMatch(/\bago\b/);
    }
  });
});
