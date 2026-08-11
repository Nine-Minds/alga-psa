import { describe, expect, it } from 'vitest';

import { formatTicketDateTime, formatTicketRelativeToNow } from '../ticketDateTimeFormat';

const TS = '2026-07-06T16:43:00.000Z';
const TZ = 'UTC';

describe('formatTicketDateTime', () => {
  it('renders the default pattern in the app locale, not en-US', () => {
    expect(formatTicketDateTime(TS, 'MMM d, yyyy h:mm a', 'en', TZ)).toBe('Jul 6, 2026, 4:43 PM');
    expect(formatTicketDateTime(TS, 'MMM d, yyyy h:mm a', 'fr', TZ)).toBe('6 juil. 2026, 16:43');
    expect(formatTicketDateTime(TS, 'MMM d, yyyy h:mm a', 'nl', TZ)).toBe('6 jul 2026, 16:43');
  });

  it('drops the 12-hour dial for locales that do not use one', () => {
    for (const locale of ['fr', 'nl', 'de', 'it', 'pl', 'pt', 'es']) {
      expect(formatTicketDateTime(TS, 'MMM d, yyyy h:mm a', locale, TZ)).not.toMatch(/\b(AM|PM)\b/);
    }
  });

  it('localizes the numeric and weekday patterns too', () => {
    expect(formatTicketDateTime(TS, 'MM/dd/yyyy h:mm a', 'fr', TZ)).toBe('06/07/2026 16:43');
    expect(formatTicketDateTime(TS, 'EEE, MMM d, yyyy h:mm a', 'fr', TZ)).toMatch(/^lun\.? 6 juil\. 2026, 16:43$/);
  });

  it('leaves the deliberately fixed patterns alone', () => {
    expect(formatTicketDateTime(TS, 'yyyy-MM-dd HH:mm', 'fr', TZ)).toBe('2026-07-06 16:43');
    expect(formatTicketDateTime(TS, 'dd/MM/yyyy HH:mm', 'fr', TZ)).toBe('06/07/2026 16:43');
  });

  it('returns the input unchanged when it is not a date', () => {
    expect(formatTicketDateTime('not-a-date', 'MMM d, yyyy h:mm a', 'fr', TZ)).toBe('not-a-date');
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
