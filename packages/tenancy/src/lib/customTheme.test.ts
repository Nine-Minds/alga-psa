import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CUSTOM_THEME,
  contrastRatio,
  findInvalidCustomThemeTokens,
  generateCustomThemeStyles,
  validateCustomThemeContrast,
} from './customTheme';
import { DEFAULT_TENANT_THEME, normalizeTenantTheme } from './tenantTheme';
import { THEME_PAIRS, isThemePairId } from './themePairs';

const clone = () => ({
  light: { ...DEFAULT_CUSTOM_THEME.light },
  dark: { ...DEFAULT_CUSTOM_THEME.dark },
});

describe('theme pairs', () => {
  it('recognizes exactly the shipped ids plus custom', () => {
    expect(isThemePairId('alga')).toBe(true);
    expect(isThemePairId('high-contrast')).toBe(true);
    expect(isThemePairId('custom')).toBe(true);
    expect(isThemePairId('teal')).toBe(false);
    expect(isThemePairId(undefined)).toBe(false);
  });

  it('offers a swatch for every predefined pair', () => {
    expect(THEME_PAIRS.map((pair) => pair.id)).toEqual([
      'alga', 'slate', 'ocean', 'forest', 'sunset', 'cappuccino', 'vice', 'high-contrast',
    ]);
    THEME_PAIRS.forEach((pair) => {
      [pair.light, pair.dark].forEach((swatch) => {
        Object.values(swatch).forEach((value) => expect(value).toMatch(/^#[0-9a-f]{6}$/i));
      });
    });
  });
});

describe('normalizeTenantTheme', () => {
  it('treats an absent or unknown setting as the default pair', () => {
    expect(normalizeTenantTheme(undefined)).toEqual(DEFAULT_TENANT_THEME);
    expect(normalizeTenantTheme(null)).toEqual(DEFAULT_TENANT_THEME);
    expect(normalizeTenantTheme({})).toEqual(DEFAULT_TENANT_THEME);
    expect(normalizeTenantTheme({ pairId: 'chartreuse' })).toEqual(DEFAULT_TENANT_THEME);
  });

  it('falls back when custom is selected without a custom theme', () => {
    expect(normalizeTenantTheme({ pairId: 'custom' })).toEqual(DEFAULT_TENANT_THEME);
  });

  it('keeps a saved custom theme when switching to a predefined pair', () => {
    const customTheme = clone();
    expect(normalizeTenantTheme({ pairId: 'ocean', customTheme })).toEqual({
      pairId: 'ocean',
      customTheme,
    });
  });

  it('only carries the white-label flag when it is on', () => {
    expect(normalizeTenantTheme({ pairId: 'alga', mspWhiteLabel: false })).toEqual({ pairId: 'alga' });
    expect(normalizeTenantTheme({ pairId: 'alga', mspWhiteLabel: true })).toEqual({
      pairId: 'alga',
      mspWhiteLabel: true,
    });
  });
});

describe('custom theme validation', () => {
  it('accepts the shipped defaults', () => {
    expect(findInvalidCustomThemeTokens(DEFAULT_CUSTOM_THEME.light)).toEqual([]);
    expect(validateCustomThemeContrast(DEFAULT_CUSTOM_THEME)).toEqual([]);
  });

  it('names the tokens that are not 6-digit hex', () => {
    expect(findInvalidCustomThemeTokens({ ...DEFAULT_CUSTOM_THEME.light, primary: 'rebeccapurple' }))
      .toEqual(['primary']);
    expect(findInvalidCustomThemeTokens({})).toHaveLength(15);
  });

  it('flags unreadable text against its background', () => {
    const theme = clone();
    theme.light.textPrimary = '#eeeeee';
    const issues = validateCustomThemeContrast(theme);
    expect(issues.some((issue) => issue.mode === 'light' && issue.pair === 'textPrimary/background')).toBe(true);
    expect(issues.every((issue) => issue.ratio < issue.required)).toBe(true);
  });

  it('computes WCAG ratios symmetrically', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });
});

describe('generateCustomThemeStyles', () => {
  it('emits nothing without a theme or with unusable colors', () => {
    expect(generateCustomThemeStyles(null)).toBe('');
    const broken = clone();
    broken.dark.card = 'not-a-color';
    expect(generateCustomThemeStyles(broken)).toBe('');
  });

  it('scopes both variants to the custom pair attribute only', () => {
    const css = generateCustomThemeStyles(DEFAULT_CUSTOM_THEME);

    expect(css).toContain('html.light[data-theme-pair="custom"] {');
    expect(css).toContain('html.dark[data-theme-pair="custom"] {');
    expect(css).not.toContain(':root');
    // No unscoped html.light / html.dark block that would leak onto other pairs.
    expect(css).not.toMatch(/html\.(light|dark) \{/);
  });

  it('keeps the shade-inversion contract: *-50 is the subtlest surface', () => {
    const css = generateCustomThemeStyles(DEFAULT_CUSTOM_THEME);
    const darkBlock = css.slice(css.indexOf('html.dark[data-theme-pair="custom"]'));
    const shade = (name: string) => {
      const match = new RegExp(`--color-${name}: (\\d+ \\d+ \\d+);`).exec(darkBlock);
      return match![1].split(' ').map(Number).reduce((sum, channel) => sum + channel, 0);
    };

    expect(shade('border-50')).toBeLessThan(shade('border-900'));
    expect(shade('primary-50')).toBeLessThan(shade('primary-900'));
  });

  it('derives chrome tokens as RGB triples, never hex', () => {
    const css = generateCustomThemeStyles(DEFAULT_CUSTOM_THEME);
    expect(css).toMatch(/--color-sidebar-bg: \d+ \d+ \d+;/);
    expect(css).not.toMatch(/--color-sidebar-bg: #/);
  });
});
