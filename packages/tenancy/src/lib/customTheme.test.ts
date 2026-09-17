import { describe, expect, it } from 'vitest';
import {
  CUSTOM_THEME_PRESETS,
  DEFAULT_CUSTOM_THEME,
  LIGHT_GROUND_FLOOR,
  contrastRatio,
  customThemePresetFor,
  describeContrastIssue,
  findInvalidCustomThemeTokens,
  generateCustomThemeStyles,
  hexToRgbTuple,
  validateCustomThemeContrast,
} from './customTheme';
import { DEFAULT_TENANT_THEME, normalizeTenantTheme } from './tenantTheme';
import { DEFAULT_THEME_PAIR_ID, THEME_PAIRS, isThemePairId } from './themePairs';

const clone = () => ({
  light: { ...DEFAULT_CUSTOM_THEME.light },
  dark: { ...DEFAULT_CUSTOM_THEME.dark },
});

/** The generated light block of a theme, tokens and all. */
const lightBlockOf = (theme: { light: typeof DEFAULT_CUSTOM_THEME.light; dark: typeof DEFAULT_CUSTOM_THEME.dark }) => {
  const css = generateCustomThemeStyles(theme);
  const start = css.indexOf('html.light[data-theme-pair="custom"]');
  return css.slice(start, css.indexOf('}', start));
};

/** One generated token, back as the hex the presets are written in. */
const tokenHex = (block: string, name: string): string => {
  const match = new RegExp(`--color-${name}: (\\d+ \\d+ \\d+);`).exec(block);
  return `#${match![1].split(' ').map((channel) => Number(channel).toString(16).padStart(2, '0')).join('')}`;
};

const brightness = (hex: string) => hexToRgbTuple(hex)!.reduce((sum, channel) => sum + channel, 0);

/** The ramp rounds to whole channels, so a clamped value can land a hair low. */
const ROUNDING_SLACK = 3;

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
      'alga', 'slate', 'ocean', 'sky', 'forest', 'sunset', 'cappuccino', 'vice', 'high-contrast',
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

  // The operator's report: "needs to be 3 to 1" told an admin nothing about
  // which two colors clashed or which way to move them.
  it('says which colors clashed and which way to move them', () => {
    const theme = clone();
    theme.light.textPrimary = '#eeeeee';
    theme.dark.textPrimary = '#12101c';
    const issues = validateCustomThemeContrast(theme);

    const light = issues.find((issue) => issue.mode === 'light' && issue.pair === 'textPrimary/background')!;
    expect(light.foreground).toBe('textPrimary');
    expect(light.background).toBe('background');
    expect(light.fix).toBe('darken');
    expect(describeContrastIssue(light)).toContain('primary text may be hard to read on the page background');
    expect(describeContrastIssue(light)).toContain('darken primary text');
    expect(describeContrastIssue(light)).not.toContain(`${light.ratio}:1`);
    expect(describeContrastIssue(light)).not.toContain(`${light.required}:1`);

    const dark = issues.find((issue) => issue.mode === 'dark' && issue.pair === 'textPrimary/background')!;
    expect(dark.fix).toBe('lighten');
    expect(describeContrastIssue(dark)).toContain('in the dark variant');
  });

  it('names the white button label rather than a token that does not exist', () => {
    const theme = clone();
    theme.light.primary = '#fdf5c9';
    const issue = validateCustomThemeContrast(theme)
      .find((candidate) => candidate.pair === 'buttonLabel/primary')!;

    expect(issue.foreground).toBe('buttonLabel');
    expect(describeContrastIssue(issue)).toContain('white button labels');
  });
});

describe('custom theme presets', () => {
  it('seeds every predefined pair, including the new ones', () => {
    expect(Object.keys(CUSTOM_THEME_PRESETS)).toEqual([
      'alga', 'slate', 'ocean', 'sky', 'forest', 'sunset', 'cappuccino', 'vice', 'high-contrast',
    ]);
  });

  // A prefilled palette that opens with contrast errors would be worse than no
  // prefill at all.
  it('ships every preset already passing the checks that gate a save', () => {
    Object.entries(CUSTOM_THEME_PRESETS).forEach(([pairId, preset]) => {
      expect(findInvalidCustomThemeTokens(preset.light), pairId).toEqual([]);
      expect(findInvalidCustomThemeTokens(preset.dark), pairId).toEqual([]);
      expect(validateCustomThemeContrast(preset), pairId).toEqual([]);
    });
  });

  it('keeps Ocean visibly navy and Sky visibly aquatic', () => {
    const distance = (left: string, right: string) => {
      const a = hexToRgbTuple(left)!;
      const b = hexToRgbTuple(right)!;
      return Math.hypot(...a.map((channel, index) => channel - b[index]));
    };

    expect(distance(CUSTOM_THEME_PRESETS.ocean.light.primary, CUSTOM_THEME_PRESETS.sky.light.primary))
      .toBeGreaterThan(50);
    expect(distance(CUSTOM_THEME_PRESETS.ocean.light.sidebarBg, CUSTOM_THEME_PRESETS.sky.light.sidebarBg))
      .toBeGreaterThan(60);
    expect(distance(CUSTOM_THEME_PRESETS.ocean.dark.card, CUSTOM_THEME_PRESETS.sky.dark.card))
      .toBeGreaterThan(20);
  });

  it('keeps Cappuccino secondary colors in the warm coffee family', () => {
    (['light', 'dark'] as const).forEach((mode) => {
      const [red, green, blue] = hexToRgbTuple(CUSTOM_THEME_PRESETS.cappuccino[mode].secondary)!;
      expect(red, mode).toBeGreaterThan(green);
      expect(green, mode).toBeGreaterThan(blue);
    });
    expect(CUSTOM_THEME_PRESETS.cappuccino.dark.secondary).toBe('#462f1e');
  });

  it('anchors Vice to its neon teal, violet, cyan, coral, and pink palette', () => {
    const vice = CUSTOM_THEME_PRESETS.vice;
    expect(vice.light.primary).toBe('#be00fe');
    expect(vice.dark.primary).toBe('#be00fe');
    expect(vice.light.secondary).toBe('#007f7f');
    expect(vice.dark.secondary).toBe('#16e3f9');
    expect(vice.light.accent).toBe('#fe5733');
    expect(vice.dark.accent).toBe('#fe6dc6');
  });

  // Same rule the predefined pairs follow: the shell ground (border-100, what
  // bg-gray-100 resolves to in dark mode) has to stay under the card.
  it('generates dark CSS whose ground stays under the card', () => {
    Object.entries(CUSTOM_THEME_PRESETS).forEach(([pairId, preset]) => {
      const css = generateCustomThemeStyles(preset);
      const darkBlock = css.slice(css.indexOf('html.dark[data-theme-pair="custom"]'));
      const value = (name: string) => {
        const match = new RegExp(`--color-${name}: (\\d+ \\d+ \\d+);`).exec(darkBlock);
        return match![1].split(' ').map(Number).reduce((sum, channel) => sum + channel, 0);
      };

      expect(value('border-100'), pairId).toBeLessThanOrEqual(value('card'));
    });
  });

  // The light mirror of the rule above. Shade-100 is what --color-app-ground
  // points at in light mode, so the whole shell paints it: an ink-black border
  // (High contrast) used to interpolate it down to #888888 under white cards,
  // and every ink rung tuned for a light ground lost its contrast there.
  it('generates light CSS whose ground stays a step under the card', () => {
    const failures: string[] = [];
    Object.entries(CUSTOM_THEME_PRESETS).forEach(([pairId, preset]) => {
      const light = lightBlockOf(preset);
      const ground = tokenHex(light, 'border-100');
      const card = tokenHex(light, 'card');

      if (brightness(ground) < brightness(card) * LIGHT_GROUND_FLOOR - ROUNDING_SLACK) {
        failures.push(`${pairId}: ground ${ground} is too dark under card ${card}`);
      }
      // text-600 is the resting ink of body chrome (tab names among them), so it
      // owes the ground full AA. text-500 is the muted rung — it interpolates
      // straight through the tenant's own textMuted, which the save-time checks
      // only hold to 3:1 — so that is what it is held to here.
      ([['text-500', 3], ['text-600', 4.5]] as const).forEach(([rung, required]) => {
        const ratio = contrastRatio(tokenHex(light, rung), ground);
        if (ratio < required) {
          failures.push(`${pairId}: ${rung} on the ground = ${ratio.toFixed(2)}:1, needs ${required}`);
        }
      });
    });

    expect(failures, `light grounds below the floor:\n${failures.join('\n')}`).toEqual([]);
  });

  // The floor is a floor, not a filter: every shipped preset already clears it,
  // so the clamp must not drift a single one of their grounds.
  it('leaves every shipped preset ground byte-identical', () => {
    const grounds = Object.fromEntries(
      Object.entries(CUSTOM_THEME_PRESETS)
        .map(([pairId, preset]) => [pairId, tokenHex(lightBlockOf(preset), 'border-100')]),
    );

    expect(grounds).toEqual({
      alga: '#edf1f6',
      slate: '#edeef1',
      ocean: '#dfe4eb',
      sky: '#d8f0fc',
      forest: '#e4ede6',
      sunset: '#f2e9dc',
      cappuccino: '#f1e8dd',
      vice: '#f8e5f1',
      // The one the clamp moves: mix(#ffffff, #111111) was a mid-grey.
      'high-contrast': '#e0e0e0',
    });
  });

  it('hands back a mutable copy and falls back to the default pair', () => {
    const forest = customThemePresetFor('forest');
    forest.light.primary = '#000000';
    expect(CUSTOM_THEME_PRESETS.forest.light.primary).not.toBe('#000000');

    expect(customThemePresetFor('custom')).toEqual(customThemePresetFor(DEFAULT_THEME_PAIR_ID));
    expect(customThemePresetFor(undefined)).toEqual(customThemePresetFor(DEFAULT_THEME_PAIR_ID));
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
