import { decorateBrandedHtml, pickBrandLogoVariant, type BrandDecorationOptions } from './brandAssets';
import { isDarkEmailHeader } from './color';
import type { EmailBrandingLogoVariant, EmailBrandingPalette, EmailPaletteTokens } from './types';

/** Decoration options with every field decided: what gets recorded on a derived row. */
export type ResolvedBrandDecoration = BrandDecorationOptions & { hideAttribution: boolean };

/**
 * The Enterprise pass over every HTML a branded template carries: the tenant's
 * logo in the header and the "Powered by AlgaPSA" line. Community gets no
 * decorator at all, even if the saved palette still carries the fields from an
 * Enterprise period, mirroring scopeBrandingToEdition.
 *
 * `resolveBrandDecoration` decides the options from the tenant's settings at
 * *write* time; the apply flow records them on the row (`derived_decoration`)
 * and the resolver replays the recorded options at send time, never the current
 * settings. One decision, recorded and replayed.
 */
export function resolveBrandDecoration(
  palette: Pick<EmailBrandingPalette, 'logo' | 'hideAttribution'>,
  branding: Record<string, any> | null | undefined,
  enterprise: boolean,
  target: EmailPaletteTokens,
): ResolvedBrandDecoration | undefined {
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
  return { ...(logo ? { logo } : {}), hideAttribution: palette.hideAttribution === true };
}

/** The decorator for resolved options: the one place options become HTML. */
export function decoratorFor(decoration: BrandDecorationOptions | null | undefined): ((html: string) => string) | undefined {
  return decoration ? (html: string) => decorateBrandedHtml(html, decoration) : undefined;
}

/** Decorating from the tenant's settings. Writers should prefer resolveBrandDecoration so they can record what they applied. */
export function brandDecorator(
  palette: Pick<EmailBrandingPalette, 'logo' | 'hideAttribution'>,
  branding: Record<string, any> | null | undefined,
  enterprise: boolean,
  target: EmailPaletteTokens,
): ((html: string) => string) | undefined {
  return decoratorFor(resolveBrandDecoration(palette, branding, enterprise, target));
}
