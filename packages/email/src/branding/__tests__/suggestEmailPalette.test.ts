import { describe, expect, it } from 'vitest';
import { CUSTOM_THEME_PRESETS } from '@alga-psa/tenancy/lib/customTheme';
import { STOCK_EMAIL_PALETTE } from '../stockPalette';
import { suggestEmailPalette } from '../suggestEmailPalette';

const customTheme = {
  light: { ...CUSTOM_THEME_PRESETS.alga.light, primary: '#b4552f', secondary: '#3f4d8a' },
  dark: CUSTOM_THEME_PRESETS.alga.dark,
};

describe('suggestEmailPalette', () => {
  it('prefers a configured custom theme', () => {
    expect(suggestEmailPalette({ theme: { pairId: 'custom', customTheme } })).toEqual({
      primary: '#b4552f',
      secondary: '#3f4d8a',
      source: 'custom-theme',
    });
  });

  it('falls back to the picked theme pair', () => {
    expect(suggestEmailPalette({ theme: { pairId: 'ocean' } })).toEqual({
      primary: CUSTOM_THEME_PRESETS.ocean.light.primary,
      secondary: CUSTOM_THEME_PRESETS.ocean.light.secondary,
      source: 'theme-pair',
    });
    expect(CUSTOM_THEME_PRESETS.ocean.light.primary).toBe('#1d4ed8');
  });

  it('prefers the picked pair over a stored custom theme, as normalizeTenantTheme does', () => {
    expect(suggestEmailPalette({ theme: { pairId: 'ocean', customTheme } }).source).toBe('theme-pair');
  });

  it('does not treat the default alga pair as a choice', () => {
    const suggestion = suggestEmailPalette({
      theme: { pairId: 'alga' },
      branding: { primaryColor: '#0f766e', secondaryColor: '#14b8a6' },
    });

    expect(suggestion).toEqual({ primary: '#0f766e', secondary: '#14b8a6', source: 'portal-branding' });
  });

  it('uses client portal branding when no theme is picked', () => {
    expect(suggestEmailPalette({ branding: { primaryColor: '#0f766e', secondaryColor: '#14b8a6' } }))
      .toEqual({ primary: '#0f766e', secondary: '#14b8a6', source: 'portal-branding' });
  });

  it('keeps the stock secondary when portal branding only sets a primary', () => {
    const suggestion = suggestEmailPalette({ branding: { primaryColor: '#0f766e', secondaryColor: '' } });

    expect(suggestion.source).toBe('portal-branding');
    expect(suggestion.secondary.toLowerCase()).toBe(STOCK_EMAIL_PALETTE.secondary.toLowerCase());
  });

  it('falls back to the stock palette', () => {
    const suggestion = suggestEmailPalette({ theme: { pairId: 'alga' }, branding: null });

    expect(suggestion.source).toBe('default');
    expect(suggestion.primary.toLowerCase()).toBe(STOCK_EMAIL_PALETTE.primary.toLowerCase());
    expect(suggestion.secondary.toLowerCase()).toBe(STOCK_EMAIL_PALETTE.secondary.toLowerCase());
  });

  it('falls back to the stock palette for an unusable theme blob', () => {
    expect(suggestEmailPalette({ theme: { pairId: 'custom' } }).source).toBe('default');
    expect(suggestEmailPalette({ theme: 'nonsense' }).source).toBe('default');
  });
});
