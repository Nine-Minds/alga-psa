import { describe, expect, it } from 'vitest';

import { normalizeCssColor, normalizeCssLength, normalizeNumber, normalizeString } from './normalizers';

describe('invoice designer inspector normalizers', () => {
  it('normalizeString trims whitespace and unsets empty strings', () => {
    expect(normalizeString('')).toBeUndefined();
    expect(normalizeString('   ')).toBeUndefined();
    expect(normalizeString('  hello  ')).toBe('hello');
  });

  it('normalizeCssLength trims and adds px for unitless numbers', () => {
    expect(normalizeCssLength('')).toBeUndefined();
    expect(normalizeCssLength('   ')).toBeUndefined();
    expect(normalizeCssLength(' 12 ')).toBe('12px');
    expect(normalizeCssLength('12.5')).toBe('12.5px');
    expect(normalizeCssLength('+7')).toBe('+7px');
    expect(normalizeCssLength('-3')).toBe('-3px');
  });

  it('normalizeCssLength preserves explicit units and keywords', () => {
    expect(normalizeCssLength(' 10rem ')).toBe('10rem');
    expect(normalizeCssLength(' 50% ')).toBe('50%');
    expect(normalizeCssLength(' auto ')).toBe('auto');
    expect(normalizeCssLength(' calc(100% - 8px) ')).toBe('calc(100% - 8px)');
  });

  it('normalizeCssColor trims and unsets empty strings', () => {
    expect(normalizeCssColor('')).toBeUndefined();
    expect(normalizeCssColor('   ')).toBeUndefined();
    expect(normalizeCssColor('  #fff  ')).toBe('#fff');
  });

  it('normalizeNumber parses numeric strings and unsets empty or invalid inputs', () => {
    expect(normalizeNumber('')).toBeUndefined();
    expect(normalizeNumber('   ')).toBeUndefined();
    expect(normalizeNumber('12')).toBe(12);
    expect(normalizeNumber(' 12.5 ')).toBe(12.5);
    expect(normalizeNumber('wat')).toBeUndefined();
  });
});

