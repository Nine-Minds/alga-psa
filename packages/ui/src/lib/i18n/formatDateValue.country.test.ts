process.env.TZ = 'UTC';

import { describe, expect, it } from 'vitest';
import { countryDateFormat, SYSTEM_DATE_FORMAT } from '@alga-psa/core/i18n/countryDateFormat';
import { formatDateValue } from './formatDateValue';

const INSTANT = new Date('2026-09-30T13:23:00.000Z');
const NUMERIC: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
};

describe('formatDateValue country pattern', () => {
  it('takes digit order and separator from the country, not the language', () => {
    const de = countryDateFormat('DE');
    // Same country, four languages: the digits never move.
    for (const locale of ['en', 'fr', 'de', 'pt']) {
      expect(formatDateValue(INSTANT, locale, NUMERIC, de)).toBe('30.09.2026');
    }
  });

  it('gives the same language different digit orders in different countries', () => {
    expect(formatDateValue(INSTANT, 'en', NUMERIC, countryDateFormat('US'))).toBe('09/30/2026');
    expect(formatDateValue(INSTANT, 'en', NUMERIC, countryDateFormat('AU'))).toBe('30/09/2026');
    expect(formatDateValue(INSTANT, 'en', NUMERIC, countryDateFormat('CA'))).toBe('2026-09-30');
  });

  it('falls back to the fixed default pattern with no country supplied', () => {
    expect(formatDateValue(INSTANT, 'fr', NUMERIC)).toBe('09/30/2026');
    expect(formatDateValue(INSTANT, 'fr', NUMERIC, SYSTEM_DATE_FORMAT)).toBe('09/30/2026');
  });

  it('keeps named months in the language and leaves their order alone', () => {
    const named: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: 'numeric' };
    expect(formatDateValue(INSTANT, 'fr', named, countryDateFormat('US'))).toBe('30 septembre 2026');
    expect(formatDateValue(INSTANT, 'en', named, countryDateFormat('DE'))).toBe('September 30, 2026');
  });

  it('forces the clock from the country whatever the language prefers', () => {
    const time: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
    // fr is a 24h language; a US tenant still reads AM/PM.
    expect(formatDateValue(INSTANT, 'fr', time, countryDateFormat('US'))).toMatch(/PM/);
    // en is a 12h language; a GB tenant still reads 24h.
    expect(formatDateValue(INSTANT, 'en', time, countryDateFormat('GB'))).toBe('13:23');
  });

  it('ignores a caller-supplied hourCycle that would reintroduce the language clock', () => {
    const time: Intl.DateTimeFormatOptions = {
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: 'h23',
    };
    expect(formatDateValue(INSTANT, 'en', time, countryDateFormat('US'))).toMatch(/PM/);
  });

  it('reorders the numeric half while leaving weekday and time where the language put them', () => {
    const full: Intl.DateTimeFormatOptions = {
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
    };
    const rendered = formatDateValue(INSTANT, 'en', full, countryDateFormat('AU'));
    expect(rendered).toContain('30/09/2026');
    expect(rendered.startsWith('Wed')).toBe(true);
  });

  it('applies the country pattern to the default (option-less) rendering', () => {
    expect(formatDateValue(INSTANT, 'en', undefined, countryDateFormat('AU'))).toBe('30/9/2026');
  });
});
