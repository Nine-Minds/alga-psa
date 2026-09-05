import { describe, expect, it } from 'vitest';
import { format } from 'date-fns';
import { getDateFnsLocale } from './dateFnsLocale';

const DATE = new Date(2026, 5, 10, 14, 30); // 2026-06-10 14:30 local

function renderP(locale?: string): string {
  return format(DATE, 'P', { locale: getDateFnsLocale(locale) });
}

describe('getDateFnsLocale', () => {
  it('maps the shipped regional variant en-AU to date-fns enAU (dd/MM/yyyy)', () => {
    // If en-AU were collapsed to its language code first, 'en' would resolve to
    // enUS and render the US month/day order — the exact regression the full
    // tag is meant to prevent.
    expect(renderP('en-AU')).toBe('10/06/2026');
    expect(renderP('en-AU')).not.toBe(renderP('en'));
  });

  it('keeps en on the US calendar (MM/dd/yyyy)', () => {
    expect(renderP('en')).toBe('06/10/2026');
  });

  it('keeps fr and de on their own calendars', () => {
    expect(renderP('fr')).toBe('10/06/2026');
    expect(renderP('de')).toBe('10.06.2026');
  });

  it('falls back to the language code for region tags we do not ship', () => {
    // en-US is not a shipped regional variant: it resolves to its language
    // code and therefore to the US calendar.
    expect(renderP('en-US')).toBe('06/10/2026');
  });

  it('defaults to enUS for unknown and missing locales', () => {
    expect(renderP('xx')).toBe('06/10/2026');
    expect(renderP(undefined)).toBe('06/10/2026');
    expect(renderP('klingon')).toBe('06/10/2026');
  });
});
