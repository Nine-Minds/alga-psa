import { afterEach, describe, expect, it, vi } from 'vitest';
import { filterPseudoLocales, getBestMatchingLocale, INCOMPLETE_LOCALES, normalizeLocale, PREVIEW_LOCALES, LOCALE_CONFIG } from './config';

describe('filterPseudoLocales', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps pseudo-locales in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const result = filterPseudoLocales(LOCALE_CONFIG.supportedLocales);
    expect(result).toContain('xx');
    expect(result).toContain('yy');
  });

  it('strips pseudo-locales in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const result = filterPseudoLocales(LOCALE_CONFIG.supportedLocales);
    expect(result).not.toContain('xx');
    expect(result).not.toContain('yy');
  });

  it('exposes pt as a production locale (no longer preview-gated)', () => {
    expect(PREVIEW_LOCALES).not.toContain('pt');
    vi.stubEnv('NODE_ENV', 'development');
    expect(filterPseudoLocales(LOCALE_CONFIG.supportedLocales)).toContain('pt');
    vi.stubEnv('NODE_ENV', 'production');
    expect(filterPseudoLocales(LOCALE_CONFIG.supportedLocales)).toContain('pt');
  });

  it('strips incomplete locales in both modes', () => {
    const sample = [...LOCALE_CONFIG.supportedLocales, 'en'] as const;
    // INCOMPLETE_LOCALES is currently empty; guard the contract for future entries.
    for (const incomplete of INCOMPLETE_LOCALES) {
      vi.stubEnv('NODE_ENV', 'development');
      expect(filterPseudoLocales(sample)).not.toContain(incomplete);
      vi.stubEnv('NODE_ENV', 'production');
      expect(filterPseudoLocales(sample)).not.toContain(incomplete);
    }
  });

  it('labels pt as Brazilian Portuguese', () => {
    expect(LOCALE_CONFIG.localeNames.pt).toBe('Português (Brasil)');
  });

  it('keeps production locales untouched', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(filterPseudoLocales(LOCALE_CONFIG.supportedLocales)).toEqual([
      'en', 'fr', 'es', 'de', 'nl', 'it', 'pl', 'pt',
    ]);
  });
});

describe('normalizeLocale', () => {
  // The packs are language-only, so region-tagged values stored by imports and
  // older UIs (a real 'pt_BR' sat in clients.properties.defaultLocale) used to
  // fail a bare isSupportedLocale check and silently do nothing.
  it.each([
    ['pt_BR', 'pt'],
    ['pt-BR', 'pt'],
    ['PT_br', 'pt'],
    ['en-US', 'en'],
    ['  de  ', 'de'],
    ['fr', 'fr'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeLocale(input)).toBe(expected);
  });

  it.each([
    ['zh-Hans-CN', 'a language we do not ship'],
    ['klingon', 'nonsense'],
    ['', 'the empty string'],
  ])('rejects %s (%s)', (input) => {
    expect(normalizeLocale(input)).toBeNull();
  });

  it('rejects non-strings rather than coercing them', () => {
    for (const value of [null, undefined, 42, {}, []]) {
      expect(normalizeLocale(value)).toBeNull();
    }
  });

  it('keeps pseudo-locales resolvable for QA', () => {
    expect(normalizeLocale('xx')).toBe('xx');
  });

  it('lets Accept-Language matching share the same rules', () => {
    expect(getBestMatchingLocale(['pt_BR'])).toBe('pt');
    expect(getBestMatchingLocale(['zh-CN', 'fr-CA'])).toBe('fr');
    expect(getBestMatchingLocale(['zh-CN'])).toBe(LOCALE_CONFIG.defaultLocale);
  });
});
