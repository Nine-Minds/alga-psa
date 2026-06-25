import { afterEach, describe, expect, it, vi } from 'vitest';
import { filterPseudoLocales, INCOMPLETE_LOCALES, LOCALE_CONFIG } from './config';

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

  it('strips incomplete locales in both modes', () => {
    expect(INCOMPLETE_LOCALES).toContain('pt');
    vi.stubEnv('NODE_ENV', 'development');
    expect(filterPseudoLocales(LOCALE_CONFIG.supportedLocales)).not.toContain('pt');
    vi.stubEnv('NODE_ENV', 'production');
    expect(filterPseudoLocales(LOCALE_CONFIG.supportedLocales)).not.toContain('pt');
  });

  it('labels pt as Brazilian Portuguese', () => {
    expect(LOCALE_CONFIG.localeNames.pt).toBe('Português (Brasil)');
  });

  it('keeps production locales untouched', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(filterPseudoLocales(LOCALE_CONFIG.supportedLocales)).toEqual([
      'en', 'fr', 'es', 'de', 'nl', 'it', 'pl',
    ]);
  });
});
