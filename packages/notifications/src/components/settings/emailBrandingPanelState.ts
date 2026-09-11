/**
 * Draft state of the email branding panel, kept apart from the component so it
 * can be reasoned about (and tested) without a DOM or a server action.
 */

import { resolveEmailPalette, type EmailPaletteOverrides, type EmailPaletteTokens } from '@alga-psa/email/branding';
import type { EmailBrandingStatus } from '../../lib/emailBranding';

/** Derived tokens the tenant may pin by hand, in the order the panel shows them. */
export const OVERRIDABLE_TOKENS = ['dark', 'outerBg', 'footerBg', 'cardBorder', 'infoBoxBg', 'infoBoxBorder'] as const;

export type OverridableToken = (typeof OVERRIDABLE_TOKENS)[number];

/** Kebab-case id fragments, so every control keeps a stable automation id. */
export const TOKEN_IDS: Record<OverridableToken, string> = {
  dark: 'dark-accent',
  outerBg: 'outer-background',
  footerBg: 'footer-background',
  cardBorder: 'card-border',
  infoBoxBg: 'info-box-background',
  infoBoxBorder: 'info-box-border',
};

export const TOKEN_FALLBACKS: Record<OverridableToken, string> = {
  dark: 'Dark accent',
  outerBg: 'Outer background',
  footerBg: 'Footer background',
  cardBorder: 'Card border',
  infoBoxBg: 'Info box background',
  infoBoxBorder: 'Info box border',
};

export const SOURCE_FALLBACKS: Record<string, string> = {
  'custom-theme': 'From your custom theme',
  'theme-pair': 'From your theme',
  'portal-branding': 'From your client portal branding',
  default: 'AlgaPSA default',
};

export interface EmailBrandingDraft {
  primary: string;
  secondary: string;
  singleColor: boolean;
  overrides: EmailPaletteOverrides;
  logoVariant: 'wide' | 'default' | null;
  hideAttribution: boolean;
}

/** A saved palette wins over the suggestion; without one the suggestion prefills. */
export function draftFromStatus(status: EmailBrandingStatus): EmailBrandingDraft {
  const palette = status.palette;
  return {
    primary: palette?.primary ?? status.suggestion.primary,
    secondary: palette?.secondary ?? status.suggestion.secondary,
    singleColor: palette ? palette.secondary === null : false,
    overrides: palette?.overrides ?? {},
    logoVariant: palette?.logo?.variant ?? null,
    hideAttribution: palette?.hideAttribution ?? false,
  };
}

export function draftMatchesSuggestion(draft: EmailBrandingDraft, status: EmailBrandingStatus): boolean {
  return draft.primary.toLowerCase() === status.suggestion.primary.toLowerCase()
    && !draft.singleColor
    && draft.secondary.toLowerCase() === status.suggestion.secondary.toLowerCase();
}

/** Dismissals live for the session only, keyed by the count that was dismissed. */
export const NEW_TEMPLATE_DISMISS_KEY = 'email-branding-new-templates-dismissed';

/**
 * The banner appears once a palette has been applied and system templates have
 * arrived since without a tenant row, and comes back when that count changes —
 * dismissing "3 new templates" must not hide the fourth.
 */
export function shouldShowNewTemplateBanner(
  status: EmailBrandingStatus,
  dismissedCount: number | null,
): boolean {
  return !!status.palette?.appliedAt
    && status.newTemplateNames.length > 0
    && dismissedCount !== status.newTemplateNames.length;
}

export function resolveDraft(draft: EmailBrandingDraft): EmailPaletteTokens {
  return resolveEmailPalette({
    primary: draft.primary,
    secondary: draft.singleColor ? null : draft.secondary,
    overrides: draft.overrides,
  });
}
