/**
 * Custom theme pair: the ~15 core colors a tenant edits per mode, the WCAG
 * checks that gate a save, and the CSS the editor precomputes so the pair can be
 * server-rendered next to the branding styles.
 *
 * The full 50-900 ramps are derived here rather than exposed in the editor —
 * same lerp the branding palette uses, so a custom pair and a branded portal
 * agree about what "primary-700" means.
 */

import { DEFAULT_THEME_PAIR_ID, type ThemePairId } from './themePairs';

type PredefinedThemePairId = Exclude<ThemePairId, 'custom'>;

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

/**
 * Core tokens of every predefined pair, so opening the editor starts from the
 * palette the tenant already picked instead of a blank purple slate: choose
 * Forest, tweak two greens, keep a balanced ramp. Values mirror the pair blocks
 * in server/src/app/globals.css (a unit test pins them together).
 */
export const CUSTOM_THEME_PRESETS: Record<PredefinedThemePairId, { light: CustomThemeTokens; dark: CustomThemeTokens }> = {
  alga: {
    light: {
      background: '#f7f8fa',
      card: '#ffffff',
      surface: '#f8fafc',
      textPrimary: '#0f172a',
      textSecondary: '#475569',
      textMuted: '#617086',
      border: '#e2e8f0',
      borderStrong: '#94a3b8',
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
      surface: '#130d24',
      textPrimary: '#e8e4f6',
      textSecondary: '#c9c3e0',
      textMuted: '#9a92b8',
      border: '#312952',
      borderStrong: '#4b3d73',
      primary: '#8a4dea',
      secondary: '#53d7fa',
      accent: '#ffa645',
      sidebarBg: '#151024',
      sidebarText: '#e8e4f6',
      sidebarHover: '#221743',
      headerBg: '#151024',
    },
  },
  slate: {
    light: {
      background: '#f2f3f5',
      card: '#ffffff',
      surface: '#f7f8f9',
      textPrimary: '#111827',
      textSecondary: '#4b5563',
      textMuted: '#666d7a',
      border: '#e2e4e8',
      borderStrong: '#b9bec7',
      primary: '#8a4dea',
      secondary: '#40cff9',
      accent: '#ff9c30',
      sidebarBg: '#0c111d',
      sidebarText: '#f5f5f5',
      sidebarHover: '#808080',
      headerBg: '#ffffff',
    },
    dark: {
      background: '#000000',
      card: '#161c30',
      surface: '#0f172a',
      textPrimary: '#f8fafc',
      textSecondary: '#cbd5e1',
      textMuted: '#94a3b8',
      border: '#334155',
      borderStrong: '#64748b',
      primary: '#9855ee',
      secondary: '#53d7fa',
      accent: '#ffa645',
      sidebarBg: '#0f172a',
      sidebarText: '#f5f5f5',
      sidebarHover: '#1e293b',
      headerBg: '#0f172a',
    },
  },
  ocean: {
    light: {
      background: '#f5f7fb',
      card: '#ffffff',
      surface: '#eef2f8',
      textPrimary: '#101828',
      textSecondary: '#344054',
      textMuted: '#5c6578',
      border: '#d0d5dd',
      borderStrong: '#98a2b3',
      primary: '#1d4ed8',
      secondary: '#0f766e',
      accent: '#d97706',
      sidebarBg: '#081a33',
      sidebarText: '#eaf2ff',
      sidebarHover: '#102f57',
      headerBg: '#ffffff',
    },
    dark: {
      background: '#040814',
      card: '#0b1324',
      surface: '#070d1b',
      textPrimary: '#edf3ff',
      textSecondary: '#b8c5da',
      textMuted: '#8494ad',
      border: '#1e2a40',
      borderStrong: '#33445f',
      primary: '#3b82f6',
      secondary: '#2dd4bf',
      accent: '#f59e0b',
      sidebarBg: '#06152b',
      sidebarText: '#edf3ff',
      sidebarHover: '#102b4f',
      headerBg: '#0b1324',
    },
  },
  sky: {
    light: {
      background: '#f3fbff',
      card: '#ffffff',
      surface: '#e9f7ff',
      textPrimary: '#082f49',
      textSecondary: '#365f78',
      textMuted: '#4f6d81',
      border: '#c7e8f8',
      borderStrong: '#7dc3e8',
      primary: '#0284c7',
      secondary: '#0891b2',
      accent: '#ea580c',
      sidebarBg: '#0c4a6e',
      sidebarText: '#ecfeff',
      sidebarHover: '#075985',
      headerBg: '#ffffff',
    },
    dark: {
      background: '#06141c',
      card: '#0c2533',
      surface: '#081b25',
      textPrimary: '#e8fbff',
      textSecondary: '#a9d6e5',
      textMuted: '#78aabd',
      border: '#174252',
      borderStrong: '#25677c',
      primary: '#0284c7',
      secondary: '#22d3ee',
      accent: '#fb923c',
      sidebarBg: '#082f49',
      sidebarText: '#ecfeff',
      sidebarHover: '#0c4a6e',
      headerBg: '#082f49',
    },
  },
  forest: {
    light: {
      background: '#f7fbf8',
      card: '#ffffff',
      surface: '#f2f7f3',
      textPrimary: '#131c16',
      textSecondary: '#4d6152',
      textMuted: '#5d6e61',
      border: '#d5e2d8',
      borderStrong: '#b7cbbc',
      primary: '#16a34a',
      secondary: '#0d9488',
      accent: '#f59e0b',
      sidebarBg: '#0c1510',
      sidebarText: '#e4f2e8',
      sidebarHover: '#17251b',
      headerBg: '#ffffff',
    },
    dark: {
      background: '#0a120d',
      card: '#121f17',
      surface: '#0c150f',
      textPrimary: '#e4f2e8',
      textSecondary: '#93ab9b',
      textMuted: '#728a79',
      border: '#1f3327',
      borderStrong: '#33513c',
      primary: '#16a34a',
      secondary: '#0d9488',
      accent: '#f59e0b',
      sidebarBg: '#121f17',
      sidebarText: '#e4f2e8',
      sidebarHover: '#1d3325',
      headerBg: '#121f17',
    },
  },
  sunset: {
    light: {
      background: '#fdfaf6',
      card: '#ffffff',
      surface: '#fbf6ef',
      textPrimary: '#1c1917',
      textSecondary: '#655d54',
      textMuted: '#74685b',
      border: '#e8dcc8',
      borderStrong: '#cdbb9c',
      primary: '#c2410c',
      secondary: '#db2777',
      accent: '#eab308',
      sidebarBg: '#1a1008',
      sidebarText: '#f6ede4',
      sidebarHover: '#2c1c0d',
      headerBg: '#ffffff',
    },
    dark: {
      background: '#140b05',
      card: '#211408',
      surface: '#180e06',
      textPrimary: '#f6ede4',
      textSecondary: '#a89383',
      textMuted: '#937d6c',
      border: '#4a2f17',
      borderStrong: '#6e4826',
      primary: '#ea580c',
      secondary: '#ec4899',
      accent: '#eab308',
      sidebarBg: '#211408',
      sidebarText: '#f6ede4',
      sidebarHover: '#3a2412',
      headerBg: '#211408',
    },
  },
  cappuccino: {
    light: {
      background: '#fdfaf7',
      card: '#ffffff',
      surface: '#faf6f1',
      textPrimary: '#211a14',
      textSecondary: '#5e4f43',
      textMuted: '#796758',
      border: '#e7d9c9',
      borderStrong: '#c3a988',
      primary: '#8b5e3c',
      secondary: '#6b442b',
      accent: '#d9944a',
      sidebarBg: '#241a12',
      sidebarText: '#f5ece2',
      sidebarHover: '#3a2a1d',
      headerBg: '#ffffff',
    },
    dark: {
      background: '#140e09',
      card: '#2a1d13',
      surface: '#1a120c',
      textPrimary: '#f5ece2',
      textSecondary: '#c8b6a4',
      textMuted: '#a3907e',
      border: '#402e20',
      borderStrong: '#5d452f',
      primary: '#a9713f',
      secondary: '#462f1e',
      accent: '#d9944a',
      sidebarBg: '#1a120c',
      sidebarText: '#f5ece2',
      sidebarHover: '#33241a',
      headerBg: '#1a120c',
    },
  },
  vice: {
    light: {
      background: '#fefafd',
      card: '#ffffff',
      surface: '#fdf5fa',
      textPrimary: '#211722',
      textSecondary: '#5b3f5a',
      textMuted: '#7c5c78',
      border: '#f2d5e8',
      borderStrong: '#d194bf',
      primary: '#be00fe',
      secondary: '#007f7f',
      accent: '#fe5733',
      sidebarBg: '#190431',
      sidebarText: '#fbe9f5',
      sidebarHover: '#2d0a52',
      headerBg: '#ffffff',
    },
    dark: {
      background: '#0d0221',
      card: '#241050',
      surface: '#140430',
      textPrimary: '#fdeff9',
      textSecondary: '#dcbce6',
      textMuted: '#c58aaa',
      border: '#54234d',
      borderStrong: '#8a2c83',
      primary: '#be00fe',
      secondary: '#16e3f9',
      accent: '#fe6dc6',
      sidebarBg: '#170538',
      sidebarText: '#fdeff9',
      sidebarHover: '#2a0d55',
      headerBg: '#170538',
    },
  },
  'high-contrast': {
    light: {
      background: '#ffffff',
      card: '#ffffff',
      surface: '#ffffff',
      textPrimary: '#000000',
      textSecondary: '#1f2937',
      textMuted: '#374151',
      border: '#111111',
      borderStrong: '#1f2937',
      primary: '#1a1a1a',
      secondary: '#1a1a1a',
      accent: '#b45309',
      sidebarBg: '#000000',
      sidebarText: '#ffffff',
      sidebarHover: '#333333',
      headerBg: '#ffffff',
    },
    dark: {
      background: '#000000',
      card: '#000000',
      surface: '#000000',
      textPrimary: '#ffffff',
      textSecondary: '#e5e7eb',
      textMuted: '#d1d5db',
      border: '#f5f5f5',
      borderStrong: '#9ca3af',
      primary: '#737373',
      secondary: '#737373',
      accent: '#f59e0b',
      sidebarBg: '#000000',
      sidebarText: '#ffffff',
      sidebarHover: '#333333',
      headerBg: '#000000',
    },
  },
};

/** Starting point for a tenant opening the editor without a pair in hand. */
export const DEFAULT_CUSTOM_THEME: { light: CustomThemeTokens; dark: CustomThemeTokens } =
  CUSTOM_THEME_PRESETS[DEFAULT_THEME_PAIR_ID as PredefinedThemePairId];

/** Fresh copy of a pair's core tokens, safe for the editor to mutate. */
export function customThemePresetFor(
  pairId: string | undefined,
): { light: CustomThemeTokens; dark: CustomThemeTokens } {
  const preset = CUSTOM_THEME_PRESETS[pairId as PredefinedThemePairId] ?? DEFAULT_CUSTOM_THEME;
  return { light: { ...preset.light }, dark: { ...preset.dark } };
}

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

/** The white button label is checked against the primary fill, not a token. */
export type CustomThemeContrastForeground = CustomThemeTokenKey | 'buttonLabel';

export interface CustomThemeContrastIssue {
  mode: CustomThemeMode;
  /** Token pair that failed, e.g. 'textPrimary/background'. */
  pair: string;
  /** Which colors clashed, so callers can name them in the reader's language. */
  foreground: CustomThemeContrastForeground;
  background: CustomThemeTokenKey;
  /** 'lighten' when the fix is a lighter foreground (dark ground), else 'darken'. */
  fix: 'lighten' | 'darken';
  ratio: number;
  required: number;
}

const CONTRAST_CHECKS: Array<{ fg: CustomThemeContrastForeground; bg: CustomThemeTokenKey; required: number }> = [
  { fg: 'textPrimary', bg: 'background', required: 4.5 },
  { fg: 'textPrimary', bg: 'card', required: 4.5 },
  { fg: 'textSecondary', bg: 'background', required: 4.5 },
  { fg: 'textMuted', bg: 'background', required: 3 },
  { fg: 'sidebarText', bg: 'sidebarBg', required: 4.5 },
  { fg: 'primary', bg: 'background', required: 3 },
  { fg: 'buttonLabel', bg: 'primary', required: 3 },
];

/** English names for the failing colors — the settings UI localizes its own. */
const CONTRAST_LABELS: Record<CustomThemeContrastForeground | CustomThemeTokenKey, string> = {
  background: 'the page background',
  card: 'the card surface',
  surface: 'the raised surface',
  textPrimary: 'primary text',
  textSecondary: 'secondary text',
  textMuted: 'muted text',
  border: 'the border color',
  borderStrong: 'the strong border color',
  primary: 'the primary color',
  secondary: 'the secondary color',
  accent: 'the accent color',
  sidebarBg: 'the side panel background',
  sidebarText: 'the side panel text',
  sidebarHover: 'the side panel hover',
  headerBg: 'the header background',
  buttonLabel: 'white button labels',
};

/** Plain-English sentence for one failure, used in thrown save errors. */
export function describeContrastIssue(issue: CustomThemeContrastIssue): string {
  const fix = issue.fix === 'lighten'
    ? `lighten ${CONTRAST_LABELS[issue.foreground]} or darken ${CONTRAST_LABELS[issue.background]}`
    : `darken ${CONTRAST_LABELS[issue.foreground]} or lighten ${CONTRAST_LABELS[issue.background]}`;
  return `in the ${issue.mode} variant, ${CONTRAST_LABELS[issue.foreground]}`
    + ` may be hard to read on ${CONTRAST_LABELS[issue.background]} — ${fix}`;
}

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
    CONTRAST_CHECKS.forEach(({ fg, bg, required }) => {
      const foreground = fg === 'buttonLabel' ? '#ffffff' : tokens[fg];
      const backgroundHex = tokens[bg];
      const ratio = contrastRatio(foreground, backgroundHex);
      if (ratio < required) {
        const backgroundRgb = hexToRgbTuple(backgroundHex);
        issues.push({
          mode,
          pair: `${fg}/${bg}`,
          foreground: fg,
          background: bg,
          // A dark ground can only be fixed by lifting the foreground.
          fix: backgroundRgb && relativeLuminance(backgroundRgb) < 0.2 ? 'lighten' : 'darken',
          ratio: Math.round(ratio * 100) / 100,
          required,
        });
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

  // Shades 50 and 100 are large surfaces in dark mode — wells inside cards and
  // the app shell's own ground (bg-gray-100) — so they have to stay under the
  // card. A palette whose border is far lighter than its card would otherwise
  // interpolate a ground that swallows the cards standing on it.
  const brightness = (color: Rgb) => color[0] + color[1] + color[2];
  const lowStops: Array<[number, Rgb]> = (() => {
    const ground = mix(surface, border, 0.5);
    if (mode === 'light' || brightness(ground) <= brightness(card)) {
      return [[0, surface], [2 / 9, border]];
    }
    const cappedGround = mix(background, card, 0.7);
    const well = brightness(surface) <= brightness(cappedGround) ? surface : mix(background, cappedGround, 0.5);
    return [[0, well], [1 / 9, cappedGround], [2 / 9, border]];
  })();

  const neutral = rampFromStops([
    ...lowStops,
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
