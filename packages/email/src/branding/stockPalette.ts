import type { EmailPaletteTokens } from './types';

/**
 * The stock AlgaPSA email palette, duplicated from
 * `server/migrations/utils/templates/_shared/constants.cjs` because that file is
 * CommonJS living in the migration tree and cannot be imported from the app.
 *
 * `stockPalette.test.ts` reads the .cjs file and compares value for value, so a
 * future palette change in the migrations cannot drift away from this map
 * silently.
 */
export const STOCK_EMAIL_PALETTE: EmailPaletteTokens = {
  gradient: 'linear-gradient(135deg,#8A4DEA,#40CFF9)',
  primary: '#8A4DEA',
  secondary: '#40CFF9',
  dark: '#5b38b0',
  outerBg: '#f5f3ff',
  footerBg: '#f8f5ff',
  cardBorder: '#e4ddff',
  cardShadow: '0 12px 32px rgba(138,77,234,0.12)',
  badgeBg: 'rgba(138,77,234,0.12)',
  infoBoxBg: '#f8f5ff',
  infoBoxBorder: '#e6deff',
};

/** Constant names in constants.cjs, keyed by token. Used by the drift test. */
export const STOCK_PALETTE_CONSTANT_NAMES: Record<keyof EmailPaletteTokens, string> = {
  gradient: 'BRAND_GRADIENT',
  primary: 'BRAND_PRIMARY',
  secondary: 'BRAND_SECONDARY',
  dark: 'BRAND_DARK',
  outerBg: 'OUTER_BG',
  footerBg: 'FOOTER_BG',
  cardBorder: 'CARD_BORDER',
  cardShadow: 'CARD_SHADOW',
  badgeBg: 'BADGE_BG',
  infoBoxBg: 'INFO_BOX_BG',
  infoBoxBorder: 'INFO_BOX_BORDER',
};

/**
 * Colors the templates use that are NOT part of the brand palette and must
 * survive a rewrite untouched (status ambers, comment-box blues, text grays).
 * Listed here so the rewrite tests can assert on them.
 */
export const NON_PALETTE_TEMPLATE_COLORS = [
  '#0f172a',
  '#1f2933',
  '#475467',
  '#eff6ff',
  '#bfdbfe',
  '#1e40af',
  '#f59e0b',
  '#92400e',
  '#fef3c7',
  '#78350f',
  '#eef2ff',
  '#ffffff',
] as const;
