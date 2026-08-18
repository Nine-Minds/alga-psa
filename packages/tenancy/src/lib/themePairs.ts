/**
 * Theme pairs: a matched light + dark variant chosen once per tenant and worn by
 * every surface (MSP shell and client portal). The per-user light/dark/system
 * toggle keeps deciding which half of the pair a person sees.
 *
 * The token values themselves live in server/src/app/globals.css under
 * `html.light[data-theme-pair="<id>"]` / `html.dark[…]`; this module is the
 * shared list of ids plus the swatches the settings previews paint with.
 */

export const THEME_PAIR_IDS = [
  'alga',
  'slate',
  'ocean',
  'sky',
  'forest',
  'sunset',
  'cappuccino',
  'vice',
  'high-contrast',
  'custom',
] as const;

export type ThemePairId = (typeof THEME_PAIR_IDS)[number];

export const DEFAULT_THEME_PAIR_ID: ThemePairId = 'alga';

/** `custom` only exists once a tenant has saved one, and only on Enterprise. */
export const PREDEFINED_THEME_PAIR_IDS = THEME_PAIR_IDS.filter(
  (id): id is Exclude<ThemePairId, 'custom'> => id !== 'custom',
);

export function isThemePairId(value: unknown): value is ThemePairId {
  return typeof value === 'string' && (THEME_PAIR_IDS as readonly string[]).includes(value);
}

export interface ThemePairSwatch {
  background: string;
  card: string;
  text: string;
  primary: string;
  sidebar: string;
}

export interface ThemePairMeta {
  id: ThemePairId;
  /** i18n key under the 'msp/settings' namespace. */
  labelKey: string;
  /** English fallback so the picker still reads sensibly without a locale pack. */
  label: string;
  descriptionKey: string;
  description: string;
  light: ThemePairSwatch;
  dark: ThemePairSwatch;
}

/** Swatches mirror the anchor values of each pair block in globals.css. */
export const THEME_PAIRS: readonly ThemePairMeta[] = [
  {
    id: 'alga',
    labelKey: 'appearance.pairs.alga.label',
    label: 'Alga',
    descriptionKey: 'appearance.pairs.alga.description',
    description: 'The default look: clean white surfaces by day, purple-tinted by night.',
    light: { background: '#f7f8fa', card: '#ffffff', text: '#0f172a', primary: '#8a4dea', sidebar: '#0c111d' },
    dark: { background: '#0c0a18', card: '#1e1836', text: '#e8e4f6', primary: '#8a4dea', sidebar: '#151024' },
  },
  {
    id: 'slate',
    labelKey: 'appearance.pairs.slate.label',
    label: 'Slate',
    descriptionKey: 'appearance.pairs.slate.description',
    description: 'Neutral grays with the original blue-slate dark theme.',
    light: { background: '#f2f3f5', card: '#ffffff', text: '#111827', primary: '#8a4dea', sidebar: '#0c111d' },
    dark: { background: '#000000', card: '#161c30', text: '#f8fafc', primary: '#9855ee', sidebar: '#0f172a' },
  },
  {
    id: 'ocean',
    labelKey: 'appearance.pairs.ocean.label',
    label: 'Ocean',
    descriptionKey: 'appearance.pairs.ocean.description',
    description: 'A navy side panel with cool blues over crisp, slightly cooled surfaces.',
    light: { background: '#f7fafd', card: '#ffffff', text: '#0f1e29', primary: '#0284c7', sidebar: '#102f52' },
    dark: { background: '#05080f', card: '#0d1726', text: '#e2ecf6', primary: '#0284c7', sidebar: '#0f2540' },
  },
  {
    id: 'sky',
    labelKey: 'appearance.pairs.sky.label',
    label: 'Sky',
    descriptionKey: 'appearance.pairs.sky.description',
    description: 'A lighter, airier blue with an indigo secondary.',
    light: { background: '#f7fbff', card: '#ffffff', text: '#0e2233', primary: '#0d95d4', sidebar: '#1e3a5f' },
    dark: { background: '#0a1420', card: '#16273c', text: '#e6f1fb', primary: '#0d95d4', sidebar: '#16273c' },
  },
  {
    id: 'forest',
    labelKey: 'appearance.pairs.forest.label',
    label: 'Forest',
    descriptionKey: 'appearance.pairs.forest.description',
    description: 'Deep greens with a teal success color so status stays readable.',
    light: { background: '#f7fbf8', card: '#ffffff', text: '#131c16', primary: '#16a34a', sidebar: '#0c1510' },
    dark: { background: '#0a120d', card: '#121f17', text: '#e4f2e8', primary: '#16a34a', sidebar: '#121f17' },
  },
  {
    id: 'sunset',
    labelKey: 'appearance.pairs.sunset.label',
    label: 'Sunset',
    descriptionKey: 'appearance.pairs.sunset.description',
    description: 'Warm oranges and dusk pink over sand-tinted surfaces.',
    light: { background: '#fdfaf6', card: '#ffffff', text: '#1c1917', primary: '#c2410c', sidebar: '#1a1008' },
    dark: { background: '#140b05', card: '#211408', text: '#f6ede4', primary: '#ea580c', sidebar: '#211408' },
  },
  {
    id: 'cappuccino',
    labelKey: 'appearance.pairs.cappuccino.label',
    label: 'Cappuccino',
    descriptionKey: 'appearance.pairs.cappuccino.description',
    description: 'Coffee browns over cream, roasted espresso after dark.',
    light: { background: '#fdfaf7', card: '#ffffff', text: '#211a14', primary: '#8b5e3c', sidebar: '#241a12' },
    dark: { background: '#140e09', card: '#2a1d13', text: '#f5ece2', primary: '#a9713f', sidebar: '#1a120c' },
  },
  {
    id: 'vice',
    labelKey: 'appearance.pairs.vice.label',
    label: 'Vice',
    descriptionKey: 'appearance.pairs.vice.description',
    description: 'Neon pink and cyan over a Miami-night purple.',
    light: { background: '#fefafd', card: '#ffffff', text: '#211722', primary: '#c4187f', sidebar: '#190431' },
    dark: { background: '#0d0221', card: '#241050', text: '#fdeff9', primary: '#e01f8b', sidebar: '#170538' },
  },
  {
    id: 'high-contrast',
    labelKey: 'appearance.pairs.highContrast.label',
    label: 'High contrast',
    descriptionKey: 'appearance.pairs.highContrast.description',
    description: 'Black and white only, with emphasized borders. Just the status colors keep their hue.',
    light: { background: '#ffffff', card: '#ffffff', text: '#000000', primary: '#1a1a1a', sidebar: '#000000' },
    dark: { background: '#000000', card: '#000000', text: '#ffffff', primary: '#737373', sidebar: '#000000' },
  },
];

export function getThemePairMeta(id: ThemePairId | undefined): ThemePairMeta | undefined {
  return THEME_PAIRS.find((pair) => pair.id === id);
}
