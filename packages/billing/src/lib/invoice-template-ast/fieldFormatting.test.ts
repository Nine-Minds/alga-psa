import { describe, expect, it } from 'vitest';

import { formatTemplateFieldValue } from './fieldFormatting';

describe('formatTemplateFieldValue currency minor units', () => {
  const format = (value: number, currencyCode: string) =>
    formatTemplateFieldValue({ value, format: 'currency', currencyCode, locale: 'en-US' }).text?.replace(/\u00a0/g, ' ');

  it('uses the currency exponent: USD 2, JPY 0, KWD 3', () => {
    expect(format(123456, 'USD')).toBe('$1,234.56');
    expect(format(123456, 'JPY')).toBe('¥123,456');
    expect(format(123456, 'KWD')).toBe('KWD 123.456');
  });
});

describe('formatTemplateFieldValue', () => {
  it('preserves date-only calendar values in negative-offset timezones', () => {
    const previousTimeZone = process.env.TZ;
    process.env.TZ = 'America/New_York';

    try {
      expect(
        formatTemplateFieldValue({
          value: '2026-07-13',
          format: 'date',
          currencyCode: 'USD',
        })
      ).toEqual({ text: '07/13/2026', multiline: false });
      expect(
        formatTemplateFieldValue({
          value: '2026-08-12',
          format: 'date',
          currencyCode: 'USD',
        })
      ).toEqual({ text: '08/12/2026', multiline: false });
    } finally {
      if (previousTimeZone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTimeZone;
      }
    }
  });

  it('formats Date instances with the existing date formatter', () => {
    expect(
      formatTemplateFieldValue({
        value: new Date('2026-07-17T12:30:00.000Z'),
        format: 'date',
        currencyCode: 'USD',
      })
    ).toEqual({ text: '07/17/2026', multiline: false });
  });

  it('returns null text for invalid Date instances', () => {
    expect(
      formatTemplateFieldValue({
        value: new Date('invalid'),
        format: 'date',
        currencyCode: 'USD',
      })
    ).toEqual({ text: null, multiline: false });
  });

  it('preserves existing primitive formatting behavior', () => {
    expect(formatTemplateFieldValue({ value: true, format: 'text', currencyCode: 'USD' })).toEqual({
      text: 'Yes',
      multiline: false,
    });
    expect(formatTemplateFieldValue({ value: 1250, format: 'currency', currencyCode: 'USD' })).toEqual({
      text: '$12.50',
      multiline: false,
    });
  });
});
