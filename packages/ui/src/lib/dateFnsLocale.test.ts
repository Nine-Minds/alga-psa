import { describe, expect, it } from 'vitest';
import { format } from 'date-fns';
import { getDateFnsLocale } from './dateFnsLocale';

const DATE = new Date(2026, 5, 10, 14, 30); // 2026-06-10 14:30 local

function renderP(locale?: string): string {
  return format(DATE, 'P', { locale: getDateFnsLocale(locale) });
}

describe('getDateFnsLocale', () => {
  it('supplies the language\'s own month and weekday names', () => {
    expect(format(DATE, 'MMMM EEEE', { locale: getDateFnsLocale('fr') })).toBe('juin mercredi');
    expect(format(DATE, 'MMMM EEEE', { locale: getDateFnsLocale('de') })).toBe('Juni Mittwoch');
    expect(format(DATE, 'MMMM EEEE', { locale: getDateFnsLocale('en') })).toBe('June Wednesday');
  });

  it('collapses every region tag to its language', () => {
    // Region no longer buys anything here: digit order comes from the tenant's
    // country, so en-AU and en-US both resolve to the shipped 'en' pack.
    expect(renderP('en-AU')).toBe(renderP('en'));
    expect(renderP('en-US')).toBe(renderP('en'));
    expect(renderP('pt-BR')).toBe(renderP('pt'));
  });

  it('defaults to enUS for unknown and missing locales', () => {
    expect(renderP('xx')).toBe('06/10/2026');
    expect(renderP(undefined)).toBe('06/10/2026');
    expect(renderP('klingon')).toBe('06/10/2026');
  });
});
