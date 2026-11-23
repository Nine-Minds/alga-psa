import { decorateBrandedHtml, pickBrandLogoVariant } from './brandAssets';
import { isDarkEmailHeader } from './color';
import type { EmailBrandingLogoVariant, EmailBrandingPalette, EmailPaletteTokens } from './types';

/**
 * The Enterprise pass over every HTML a branded template carries: the tenant's
 * logo in the header and the "Powered by AlgaPSA" line. Community gets no
 * decorator at all, even if the saved palette still carries the fields from an
 * Enterprise period, mirroring scopeBrandingToEdition.
 *
 * One composition for both writers of branded HTML: the apply flow that stores
 * it and the resolver that derives it at send time. They must never decorate
 * differently, so neither builds its own.
 */
export function brandDecorator(
  palette: Pick<EmailBrandingPalette, 'logo' | 'hideAttribution'>,
  branding: Record<string, any> | null | undefined,
  enterprise: boolean,
  target: EmailPaletteTokens,
): ((html: string) => string) | undefined {
  if (!enterprise) return undefined;

  // The written row references the logo by content-id, never by URL: the bytes
  // are attached at send time. Only the variant is decided here — the shape the
  // tenant picked, in the artwork that reads on the header this palette paints
  // or the one they pinned — and only one the tenant has actually uploaded may
  // be written.
  const variant: EmailBrandingLogoVariant | null = palette.logo
    ? pickBrandLogoVariant(palette.logo.variant, isDarkEmailHeader(target), {
        logoUrl: branding?.logoUrl || undefined,
        logoDarkUrl: branding?.logoDarkUrl || undefined,
        logoWideUrl: branding?.logoWideUrl || undefined,
        logoWideDarkUrl: branding?.logoWideDarkUrl || undefined,
      }, palette.logo.artwork)
    : null;
  const logo = variant ? { variant, alt: branding?.clientName ?? '' } : undefined;
  const hideAttribution = palette.hideAttribution === true;

  return (html: string) => decorateBrandedHtml(html, { logo, hideAttribution });
}
