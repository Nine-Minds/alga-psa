/**
 * Shared brand constants for email templates.
 *
 * These values are the canonical brand colors used across all email templates.
 * Sourced from migration 20260109100000_standardize_email_template_styling.cjs
 * which standardized all templates to use these colors.
 */

const BRAND_GRADIENT = 'linear-gradient(135deg,#8A4DEA,#40CFF9)';
const BRAND_PRIMARY = '#8A4DEA';
const BRAND_SECONDARY = '#40CFF9';
const BRAND_DARK = '#5b38b0';

const FOOTER_BG = '#f8f5ff';
const OUTER_BG = '#f5f3ff';
const CARD_BORDER = '#e4ddff';
const CARD_SHADOW = '0 12px 32px rgba(138,77,234,0.12)';
const BADGE_BG = 'rgba(138,77,234,0.12)';
const INFO_BOX_BG = '#f8f5ff';
const INFO_BOX_BORDER = '#e6deff';

const FONT_STACK = "Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";
const HEADING_FONT = "Poppins,system-ui,sans-serif";

const SUPPORTED_LANGUAGES = ['en', 'fr', 'es', 'de', 'nl', 'it', 'pl'];

module.exports = {
  BRAND_GRADIENT,
  BRAND_PRIMARY,
  BRAND_SECONDARY,
  BRAND_DARK,
  FOOTER_BG,
  OUTER_BG,
  CARD_BORDER,
  CARD_SHADOW,
  BADGE_BG,
  INFO_BOX_BG,
  INFO_BOX_BORDER,
  FONT_STACK,
  HEADING_FONT,
  SUPPORTED_LANGUAGES,
};
