/**
 * Email white-labeling types.
 *
 * The token map mirrors `server/migrations/utils/templates/_shared/constants.cjs`
 * key for key: every color a system email template paints with lives here, so a
 * tenant palette can be substituted into a template with a literal rewrite.
 */

export interface EmailPaletteTokens {
  gradient: string;
  primary: string;
  secondary: string;
  dark: string;
  outerBg: string;
  footerBg: string;
  cardBorder: string;
  cardShadow: string;
  badgeBg: string;
  infoBoxBg: string;
  infoBoxBorder: string;
}

export type EmailPaletteTokenKey = keyof EmailPaletteTokens;

/** Derived tokens a tenant may pin by hand instead of accepting the derivation. */
export const EMAIL_PALETTE_OVERRIDE_KEYS = [
  'dark',
  'outerBg',
  'footerBg',
  'cardBorder',
  'infoBoxBg',
  'infoBoxBorder',
] as const;

export type EmailPaletteOverrideKey = (typeof EMAIL_PALETTE_OVERRIDE_KEYS)[number];

export interface EmailPaletteOverrides extends Partial<Record<EmailPaletteOverrideKey, string>> {
  /** Alpha used for the card shadow and badge tint. Defaults to 0.12. */
  badgeAlpha?: number;
}

export type EmailBrandingLogoVariant = 'wide' | 'default';

/** Shape persisted at `tenant_settings.settings.emailBranding`. */
export interface EmailBrandingPalette {
  primary: string;
  /** null means single-color mode: the gradient end is derived from primary. */
  secondary: string | null;
  overrides?: EmailPaletteOverrides;
  /** Enterprise only. */
  logo?: { variant: EmailBrandingLogoVariant };
  /** Enterprise only. */
  hideAttribution?: boolean;
  /** ISO timestamp of the last successful apply. */
  appliedAt?: string;
  /** The token map that was written, so a re-apply can recognize its own rows. */
  appliedPalette?: EmailPaletteTokens;
}

export type EmailBrandingSuggestionSource =
  | 'custom-theme'
  | 'theme-pair'
  | 'portal-branding'
  | 'default';

export interface EmailBrandingSuggestion {
  primary: string;
  secondary: string;
  source: EmailBrandingSuggestionSource;
}

export type TenantTemplateState = 'system' | 'branded' | 'customized' | 'no-stock-colors';

export type TenantTemplateDifference = 'colors' | 'text' | 'subject';

export interface TenantTemplateClassification {
  state: TenantTemplateState;
  differs: TenantTemplateDifference[];
}
