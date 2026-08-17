/**
 * Custom theme pair: the ~15 core colors a tenant edits per mode, the WCAG
 * checks that gate a save, and the CSS the editor precomputes so the pair can be
 * server-rendered next to the branding styles.
 *
 * The full 50-900 ramps are derived here rather than exposed in the editor —
 * same lerp the branding palette uses, so a custom pair and a branded portal
 * agree about what "primary-700" means.
 */

export const CUSTOM_THEME_TOKEN_KEYS = [
  'background',
  'card',
  'surface',
  'textPrimary',
  'textSecondary',
  'textMuted',
  'border',
  'borderStrong',
  'primary',
  'secondary',
  'accent',
  'sidebarBg',
  'sidebarText',
  'sidebarHover',
  'headerBg',
] as const;

export type CustomThemeTokenKey = (typeof CUSTOM_THEME_TOKEN_KEYS)[number];
export type CustomThemeTokens = Record<CustomThemeTokenKey, string>;

export type CustomThemeMode = 'light' | 'dark';

export interface CustomTheme {
  light: CustomThemeTokens;
  dark: CustomThemeTokens;
  /** Precomputed CSS, cached so SSR never has to regenerate it. */
  computedStyles?: string;
}

/** Starting point for a tenant opening the editor: today's Alga pair. */
export const DEFAULT_CUSTOM_THEME: { light: CustomThemeTokens; dark: CustomThemeTokens } = {
  light: {
    background: '#ffffff',
    card: '#ffffff',
    surface: '#f8fafc',
    textPrimary: '#0f172a',
    textSecondary: '#475569',
    textMuted: '#64748b',
    border: '#e2e8f0',
    borderStrong: '#cbd5e1',
    primary: '#8a4dea',
    secondary: '#40cff9',
    accent: '#ff9c30',
    sidebarBg: '#0c111d',
    sidebarText: '#f5f5f5',
    sidebarHover: '#808080',
    headerBg: '#ffffff',
  },
  dark: {
    background: '#0c0a18',
    card: '#1e1836',
    surface: '#1b1530',
    textPrimary: '#e8e4f6',
    textSecondary: '#c9c3e0',
    textMuted: '#9a92b8',
    border: '#272041',
    borderStrong: '#3a2f59',
    primary: '#8a4dea',
    secondary: '#40cff9',
    accent: '#ff9c30',
    sidebarBg: '#151024',
    sidebarText: '#e8e4f6',
    sidebarHover: '#221743',
    headerBg: '#151024',
  },
};

type Rgb = [number, number, number];

export const hexToRgbTuple = (hex: string): Rgb | null => {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex ?? '');
  return match
    ? [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)]
    : null;
};

const mix = (a: Rgb, b: Rgb, t: number): Rgb =>
  [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as Rgb;

const triple = (rgb: Rgb): string => rgb.join(' ');

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

/** Interpolate a 10-step ramp through positioned anchors (0 = shade 50, 1 = shade 900). */
const rampFromStops = (stops: Array<[number, Rgb]>): string[] =>
  SHADES.map((_, index) => {
    const position = index / 9;
    let lower = stops[0];
    let upper = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i += 1) {
      if (position >= stops[i][0] && position <= stops[i + 1][0]) {
        lower = stops[i];
        upper = stops[i + 1];
        break;
      }
    }
    const span = upper[0] - lower[0];
    return triple(mix(lower[1], upper[1], span === 0 ? 0 : (position - lower[0]) / span));
  });

/** Same ramp branding uses, so a custom pair and a branded portal agree on shades. */
const brandRamp = (base: Rgb, mode: CustomThemeMode): string[] => {
  const white: Rgb = [255, 255, 255];
  const lightRamp: string[] = [
    triple(mix(base, white, 0.95)),
    triple(mix(base, white, 0.9)),
    triple(mix(base, white, 0.75)),
    triple(mix(base, white, 0.6)),
    triple(mix(base, white, 0.3)),
    triple(base),
    triple(base.map((c) => Math.round(c * 0.85)) as Rgb),
    triple(base.map((c) => Math.round(c * 0.7)) as Rgb),
    triple(base.map((c) => Math.round(c * 0.5)) as Rgb),
    triple(base.map((c) => Math.round(c * 0.3)) as Rgb),
  ];

  if (mode === 'light') return lightRamp;

  // Dark keeps the inversion contract: *-50 stays the subtlest surface.
  return [
    lightRamp[9], lightRamp[8], lightRamp[7], lightRamp[6], lightRamp[4],
    lightRamp[5], lightRamp[3], lightRamp[2], lightRamp[1], lightRamp[0],
  ];
};

const paletteVars = (name: string, ramp: string[]): string =>
  SHADES.map((shade, index) => `      --color-${name}-${shade}: ${ramp[index]};`).join('\n');

const relativeLuminance = (rgb: Rgb): number => {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
};

export const contrastRatio = (a: string, b: string): number => {
  const rgbA = hexToRgbTuple(a);
  const rgbB = hexToRgbTuple(b);
  if (!rgbA || !rgbB) return 0;
  const lumA = relativeLuminance(rgbA);
  const lumB = relativeLuminance(rgbB);
  const [light, dark] = lumA > lumB ? [lumA, lumB] : [lumB, lumA];
  return (light + 0.05) / (dark + 0.05);
};

export interface CustomThemeContrastIssue {
  mode: CustomThemeMode;
  /** Token pair that failed, e.g. 'textPrimary/background'. */
  pair: string;
  ratio: number;
  required: number;
}

const CONTRAST_CHECKS: Array<{ pair: string; fg: CustomThemeTokenKey | '#ffffff'; bg: CustomThemeTokenKey; required: number }> = [
  { pair: 'textPrimary/background', fg: 'textPrimary', bg: 'background', required: 4.5 },
  { pair: 'textPrimary/card', fg: 'textPrimary', bg: 'card', required: 4.5 },
  { pair: 'textSecondary/background', fg: 'textSecondary', bg: 'background', required: 4.5 },
  { pair: 'textMuted/background', fg: 'textMuted', bg: 'background', required: 3 },
  { pair: 'sidebarText/sidebarBg', fg: 'sidebarText', bg: 'sidebarBg', required: 4.5 },
  { pair: 'primary/background', fg: 'primary', bg: 'background', required: 3 },
  { pair: 'buttonLabel/primary', fg: '#ffffff', bg: 'primary', required: 3 },
];

/** Every token must be a 6-digit hex; missing/short values are rejected up front. */
export function findInvalidCustomThemeTokens(tokens: Partial<CustomThemeTokens>): CustomThemeTokenKey[] {
  return CUSTOM_THEME_TOKEN_KEYS.filter((key) => !hexToRgbTuple(tokens[key] ?? ''));
}

export function validateCustomThemeContrast(
  theme: { light: CustomThemeTokens; dark: CustomThemeTokens },
): CustomThemeContrastIssue[] {
  const issues: CustomThemeContrastIssue[] = [];
  (['light', 'dark'] as const).forEach((mode) => {
    const tokens = theme[mode];
    CONTRAST_CHECKS.forEach(({ pair, fg, bg, required }) => {
      const foreground = fg === '#ffffff' ? '#ffffff' : tokens[fg];
      const ratio = contrastRatio(foreground, tokens[bg]);
      if (ratio < required) {
        issues.push({ mode, pair, ratio: Math.round(ratio * 100) / 100, required });
      }
    });
  });
  return issues;
}

function modeBlock(selector: string, tokens: CustomThemeTokens, mode: CustomThemeMode): string {
  const rgb = (key: CustomThemeTokenKey): Rgb => hexToRgbTuple(tokens[key]) ?? [0, 0, 0];
  const background = rgb('background');
  const card = rgb('card');
  const surface = rgb('surface');
  const border = rgb('border');
  const borderStrong = rgb('borderStrong');
  const textMuted = rgb('textMuted');
  const textSecondary = rgb('textSecondary');
  const textPrimary = rgb('textPrimary');
  const sidebarBg = rgb('sidebarBg');
  const sidebarText = rgb('sidebarText');

  const neutral = rampFromStops([
    [0, surface],
    [2 / 9, border],
    [3 / 9, borderStrong],
    [5 / 9, textMuted],
    [6 / 9, textSecondary],
    [1, textPrimary],
  ]);

  const primaryRamp = brandRamp(rgb('primary'), mode);
  const secondaryRamp = brandRamp(rgb('secondary'), mode);
  const accentRamp = brandRamp(rgb('accent'), mode);
  const primary = rgb('primary');

  return `    ${selector} {
      --background: ${background.join(', ')};
      --color-background: ${triple(background)};
      --color-card: ${triple(card)};

      --color-border-base: ${neutral[4]};
${paletteVars('border', neutral)}

      --color-text-base: ${neutral[4]};
${paletteVars('text', neutral)}

${paletteVars('primary', primaryRamp)}

${paletteVars('secondary', secondaryRamp)}

${paletteVars('accent', accentRamp)}

      --color-table-row-alt: ${triple(surface)};
      --color-table-hover: ${triple(mix(background, primary, 0.12))};
      --color-table-selected: ${triple(mix(background, primary, 0.2))};

      --color-sidebar-bg: ${triple(sidebarBg)};
      --color-sidebar-text: ${triple(sidebarText)};
      --color-sidebar-hover: ${triple(rgb('sidebarHover'))};
      --color-sidebar-icon: ${triple(mix(sidebarBg, sidebarText, 0.6))};

      --color-header-bg: ${triple(rgb('headerBg'))};
      --color-header-text: ${triple(textPrimary)};
      --color-header-border: ${triple(border)};

      --color-submenu-bg: ${triple(surface)};
      --color-submenu-text: ${triple(textPrimary)};
      --color-submenu-hover: ${triple(border)};
      --color-submenu-icon: ${triple(textMuted)};
    }`;
}

/**
 * CSS for the "custom" pair. Scoped by the same data-theme-pair attribute the
 * predefined pairs use, so nothing leaks into a tenant that hasn't chosen it.
 */
export function generateCustomThemeStyles(
  theme: { light: CustomThemeTokens; dark: CustomThemeTokens } | null | undefined,
): string {
  if (!theme) return '';
  if (findInvalidCustomThemeTokens(theme.light).length || findInvalidCustomThemeTokens(theme.dark).length) {
    return '';
  }

  return `
${modeBlock('html.light[data-theme-pair="custom"]', theme.light, 'light')}

${modeBlock('html.dark[data-theme-pair="custom"]', theme.dark, 'dark')}
`;
}
