import { describe, expect, it } from 'vitest';
import {
  normalizeEmailBrandingInput,
  readEmailBrandingPalette,
  resolveTenantLanguages,
} from './emailBranding';

const ALL_LANGUAGES = ['de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt'];

describe('normalizeEmailBrandingInput', () => {
  it('normalizes hex input and single-color mode', () => {
    expect(normalizeEmailBrandingInput({ primary: '#B4552F', secondary: null }, false))
      .toEqual({ primary: '#b4552f', secondary: null });
  });

  it('rejects a malformed primary', () => {
    expect(() => normalizeEmailBrandingInput({ primary: '#zzz' }, false))
      .toThrow(/Invalid email branding color for primary/);
  });

  it('rejects a malformed override and an out-of-range alpha', () => {
    expect(() => normalizeEmailBrandingInput({ primary: '#b4552f', overrides: { cardBorder: 'teal' } }, false))
      .toThrow(/Invalid email branding color for cardBorder/);
    expect(() => normalizeEmailBrandingInput({ primary: '#b4552f', overrides: { badgeAlpha: 4 } }, false))
      .toThrow(/Invalid email branding badge alpha/);
  });

  it('keeps logo and attribution on Enterprise', () => {
    const palette = normalizeEmailBrandingInput(
      { primary: '#b4552f', secondary: '#3f4d8a', logo: { variant: 'wide' }, hideAttribution: true },
      true,
    );

    expect(palette.logo).toEqual({ variant: 'wide' });
    expect(palette.hideAttribution).toBe(true);
  });

  it('drops logo and attribution on Community while keeping the colors', () => {
    const palette = normalizeEmailBrandingInput(
      { primary: '#b4552f', secondary: '#3f4d8a', logo: { variant: 'wide' }, hideAttribution: true },
      false,
    );

    expect(palette).toEqual({ primary: '#b4552f', secondary: '#3f4d8a' });
  });

  it('drops empty overrides instead of persisting blanks', () => {
    expect(normalizeEmailBrandingInput({ primary: '#b4552f', overrides: { cardBorder: '' } }, false).overrides)
      .toBeUndefined();
  });
});

describe('readEmailBrandingPalette', () => {
  it('reads a saved palette with its applied history', () => {
    const palette = readEmailBrandingPalette({
      primary: '#B4552F',
      secondary: '#3f4d8a',
      appliedAt: '2026-09-09T10:00:00.000Z',
      appliedPalette: { primary: '#b4552f' },
    });

    expect(palette).toMatchObject({
      primary: '#b4552f',
      secondary: '#3f4d8a',
      appliedAt: '2026-09-09T10:00:00.000Z',
    });
  });

  it('ignores a blob with no usable primary', () => {
    expect(readEmailBrandingPalette(null)).toBeNull();
    expect(readEmailBrandingPalette({})).toBeNull();
    expect(readEmailBrandingPalette({ primary: 'purple' })).toBeNull();
  });
});

describe('resolveTenantLanguages', () => {
  it('falls back to English for a tenant that configured nothing', () => {
    expect(resolveTenantLanguages({}, ALL_LANGUAGES)).toEqual(['en']);
  });

  it('collects the MSP, portal and enabled locales, region tags included', () => {
    const languages = resolveTenantLanguages({
      defaultLocale: 'fr',
      mspPortal: { defaultLocale: 'de' },
      clientPortal: { defaultLocale: 'es', enabledLocales: ['pt_BR', 'it'] },
    }, ALL_LANGUAGES);

    expect(languages).toEqual(['de', 'en', 'es', 'fr', 'it', 'pt']);
  });

  it('drops languages the templates do not ship', () => {
    expect(resolveTenantLanguages({ defaultLocale: 'ja' }, ALL_LANGUAGES)).toEqual(['en']);
  });
});
