import { describe, expect, it } from 'vitest';
import { countryDateFormat, SYSTEM_DATE_FORMAT } from '@alga-psa/core/i18n/countryDateFormat';

import { formatTemplateDateValue, formatTemplateFieldValue } from './fieldFormatting';

/**
 * A document is dated the way its RECIPIENT writes dates. The country decides
 * digit order and separator; the language only ever names months and weekdays,
 * so translating an invoice must never renumber it.
 */
describe('formatTemplateDateValue by country', () => {
  const invoiceDate = '2026-09-30';

  it('writes the digit order and separator the country uses', () => {
    expect(formatTemplateDateValue(invoiceDate, 'en', countryDateFormat('GB'))).toBe('30/09/2026');
    expect(formatTemplateDateValue(invoiceDate, 'en', countryDateFormat('DE'))).toBe('30.09.2026');
    expect(formatTemplateDateValue(invoiceDate, 'en', countryDateFormat('US'))).toBe('09/30/2026');
  });

  it("falls back to the system default for 'XX' and for an unknown country", () => {
    const systemDefault = formatTemplateDateValue(invoiceDate, 'en', SYSTEM_DATE_FORMAT);

    expect(systemDefault).toBe('09/30/2026');
    expect(formatTemplateDateValue(invoiceDate, 'en', countryDateFormat('XX'))).toBe(systemDefault);
    expect(formatTemplateDateValue(invoiceDate, 'en', countryDateFormat(null))).toBe(systemDefault);
    expect(formatTemplateDateValue(invoiceDate, 'en')).toBe(systemDefault);
  });

  it('keeps the country order when the document language changes', () => {
    const gb = countryDateFormat('GB');

    expect(formatTemplateDateValue(invoiceDate, 'fr', gb)).toBe('30/09/2026');
    expect(formatTemplateDateValue(invoiceDate, 'de', gb)).toBe('30/09/2026');
    // …and a US document stays month-first however it is read.
    expect(formatTemplateDateValue(invoiceDate, 'fr', countryDateFormat('US'))).toBe('09/30/2026');
  });

  it('carries the country shape through field formatting', () => {
    expect(
      formatTemplateFieldValue({
        value: invoiceDate,
        format: 'date',
        currencyCode: 'GBP',
        locale: 'en',
        dateFormat: countryDateFormat('GB'),
      })
    ).toEqual({ text: '30/09/2026', multiline: false });
  });

  it('keeps a date-only value on its written day west of UTC', () => {
    const previousTimeZone = process.env.TZ;
    process.env.TZ = 'America/New_York';

    try {
      expect(formatTemplateDateValue(invoiceDate, 'en', countryDateFormat('GB'))).toBe('30/09/2026');
    } finally {
      if (previousTimeZone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTimeZone;
      }
    }
  });
});
