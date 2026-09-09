/**
 * Email white-labeling: a pure palette engine shared by the settings panel, the
 * apply action and the template editor. Nothing here touches the database or
 * the network, so it runs unchanged in the browser and on the server.
 */

export * from './types';
export { STOCK_EMAIL_PALETTE, NON_PALETTE_TEMPLATE_COLORS } from './stockPalette';
export { isHexColor, normalizeHex } from './color';
export { resolveEmailPalette, DEFAULT_BADGE_ALPHA, type ResolvableEmailPalette } from './resolveEmailPalette';
export {
  applyEmailPalette,
  containsEmailPaletteTokens,
  extractColorLiterals,
  stripColorLiterals,
} from './applyEmailPalette';
