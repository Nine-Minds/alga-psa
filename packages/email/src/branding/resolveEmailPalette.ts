import { mixWithWhite, normalizeHex, rgbaString, scaleLightness } from './color';
import { STOCK_EMAIL_PALETTE } from './stockPalette';
import type { EmailPaletteOverrides, EmailPaletteTokens } from './types';

export interface ResolvableEmailPalette {
  primary: string;
  /** null or undefined means single-color mode. */
  secondary?: string | null;
  overrides?: EmailPaletteOverrides;
}

/** FR2 derivation ratios. */
const DARK_LIGHTNESS_FACTOR = 0.75;
const SINGLE_COLOR_LIGHTNESS_FACTOR = 1.18;
const OUTER_BG_WHITE = 0.95;
const SURFACE_WHITE = 0.96;
const CARD_BORDER_WHITE = 0.88;
const INFO_BORDER_WHITE = 0.9;
export const DEFAULT_BADGE_ALPHA = 0.12;

const isStockColor = (value: string | null | undefined, stock: string): boolean =>
  !!value && normalizeHex(value) === normalizeHex(stock);

/**
 * Turns a tenant's one or two brand colors into the full token map a template
 * is painted with.
 *
 * The stock primary/secondary short-circuit to the literal stock map: the
 * hand-picked purple tints in constants.cjs are not reproducible from #8A4DEA
 * by any single formula, and a tenant who keeps the AlgaPSA colors must get
 * templates that stay byte-identical to the system ones.
 */
export function resolveEmailPalette(palette: ResolvableEmailPalette): EmailPaletteTokens {
  const primary = normalizeHex(palette.primary) ?? STOCK_EMAIL_PALETTE.primary;
  const overrides = palette.overrides ?? {};
  const hasOverrides = Object.values(overrides).some((value) => value !== undefined && value !== null);

  if (
    !hasOverrides &&
    isStockColor(palette.primary, STOCK_EMAIL_PALETTE.primary) &&
    isStockColor(palette.secondary ?? undefined, STOCK_EMAIL_PALETTE.secondary)
  ) {
    return { ...STOCK_EMAIL_PALETTE };
  }

  const secondary = palette.secondary
    ? normalizeHex(palette.secondary) ?? primary
    : scaleLightness(primary, SINGLE_COLOR_LIGHTNESS_FACTOR);

  const alpha = typeof overrides.badgeAlpha === 'number' ? overrides.badgeAlpha : DEFAULT_BADGE_ALPHA;
  const tint = rgbaString(primary, alpha);

  const derived: EmailPaletteTokens = {
    gradient: `linear-gradient(135deg,${primary},${secondary})`,
    primary,
    secondary,
    dark: scaleLightness(primary, DARK_LIGHTNESS_FACTOR),
    outerBg: mixWithWhite(primary, OUTER_BG_WHITE),
    footerBg: mixWithWhite(primary, SURFACE_WHITE),
    cardBorder: mixWithWhite(primary, CARD_BORDER_WHITE),
    cardShadow: `0 12px 32px ${tint}`,
    badgeBg: tint,
    infoBoxBg: mixWithWhite(primary, SURFACE_WHITE),
    infoBoxBorder: mixWithWhite(primary, INFO_BORDER_WHITE),
  };

  for (const key of ['dark', 'outerBg', 'footerBg', 'cardBorder', 'infoBoxBg', 'infoBoxBorder'] as const) {
    const override = normalizeHex(overrides[key] ?? '');
    if (override) derived[key] = override;
  }

  return derived;
}
