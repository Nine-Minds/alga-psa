/**
 * Enterprise brand assets in email templates: the tenant's logo in the header
 * and the "Powered by AlgaPSA" footer line.
 *
 * Both passes are idempotent and run after the color rewrite, so applying twice
 * leaves exactly one logo and one footer.
 */

import type { EmailBrandingLogoShape, EmailBrandingLogoVariant } from './types';

export const BRAND_LOGO_MARKER = 'data-alga-brand-logo';

/**
 * Content-IDs the logo travels under. The variant lives in the cid, so the HTML
 * alone says which file the send-time pass has to attach.
 */
export const BRAND_LOGO_CIDS = {
  default: 'alga-brand-logo',
  dark: 'alga-brand-logo-dark',
  wide: 'alga-brand-logo-wide',
  'wide-dark': 'alga-brand-logo-wide-dark',
} as const satisfies Record<EmailBrandingLogoVariant, string>;

export function brandLogoCid(variant: EmailBrandingLogoVariant = 'default'): string {
  return BRAND_LOGO_CIDS[variant] ?? BRAND_LOGO_CIDS.default;
}

/** The reverse of brandLogoCid, over a `cid:...` src or a bare content-id. */
export function parseBrandLogoVariant(value: string | null | undefined): EmailBrandingLogoVariant | null {
  if (!value) return null;
  const cid = value.trim().replace(/^cid:/i, '').replace(/^<(.*)>$/, '$1');
  const match = (Object.keys(BRAND_LOGO_CIDS) as EmailBrandingLogoVariant[])
    .find((variant) => BRAND_LOGO_CIDS[variant] === cid);
  return match ?? null;
}

const EXISTING_LOGO = new RegExp(`<img\\b[^>]*${BRAND_LOGO_MARKER}[^>]*>\\s*`, 'gi');
const MARKER_TAG = new RegExp(`<img\\b[^>]*${BRAND_LOGO_MARKER}[^>]*>`, 'gi');
const FIRST_MARKER_TAG = new RegExp(`<img\\b[^>]*${BRAND_LOGO_MARKER}[^>]*>`, 'i');
/** A hand-edited template may quote src either way, or not at all. */
const SRC_ATTRIBUTE = /\ssrc=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

/** The gradient header cell of the shared layout. */
const LAYOUT_HEADER_CELL = /<td\b[^>]*linear-gradient\([^>]*>/i;
const FIRST_HEADING = /<h1\b|<h2\b/i;
const BODY_OPEN = /<body\b[^>]*>/i;

const escapeAttribute = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** The src of an `<img>`, whatever quoting the tag uses. */
export function readImgSrc(tag: string): string | undefined {
  const match = SRC_ATTRIBUTE.exec(tag);
  return match ? match[1] ?? match[2] ?? match[3] : undefined;
}

/** Replaces the src of an `<img>`, or adds one to a tag that carries none. */
export function withImgSrc(tag: string, src: string): string {
  const attribute = ` src="${escapeAttribute(src)}"`;
  return SRC_ATTRIBUTE.test(tag)
    ? tag.replace(SRC_ATTRIBUTE, () => attribute)
    : tag.replace(/^<img\b/i, `<img${attribute}`);
}

/** The content-id the template's logo tag references, for the editor hint. */
export function findBrandLogoCid(html: string): string | null {
  const tag = html ? FIRST_MARKER_TAG.exec(html)?.[0] : null;
  const variant = tag ? parseBrandLogoVariant(readImgSrc(tag)) : null;
  return variant ? brandLogoCid(variant) : null;
}

export interface BrandLogo {
  variant: EmailBrandingLogoVariant;
  alt?: string;
}

export interface BrandDecorationOptions {
  logo?: BrandLogo;
  hideAttribution?: boolean;
}

/**
 * The stored row references the logo by content-id, never by URL: a mail client
 * has no origin to resolve a path against, and any remote URL is held behind
 * "download images". The bytes are attached at send time.
 */
function logoTag(logo: BrandLogo): string {
  return `<img ${BRAND_LOGO_MARKER} src="cid:${brandLogoCid(logo.variant)}" alt="${escapeAttribute(logo.alt ?? '')}" style="max-height:40px;margin-bottom:12px"/>`;
}

/**
 * Puts the tenant's logo at the top of the card: inside the gradient header
 * cell for the shared layout, or before the first heading for the auth
 * templates that bring their own structure.
 */
export function applyBrandLogo(html: string, logo: BrandLogo): string {
  if (!html || !logo?.variant) return html;

  const withoutExisting = html.replace(EXISTING_LOGO, '');
  const tag = logoTag(logo);

  const headerCell = LAYOUT_HEADER_CELL.exec(withoutExisting);
  if (headerCell) {
    const insertAt = headerCell.index + headerCell[0].length;
    return `${withoutExisting.slice(0, insertAt)}\n          ${tag}${withoutExisting.slice(insertAt)}`;
  }

  const heading = FIRST_HEADING.exec(withoutExisting);
  if (heading) {
    return `${withoutExisting.slice(0, heading.index)}${tag}\n    ${withoutExisting.slice(heading.index)}`;
  }

  const body = BODY_OPEN.exec(withoutExisting);
  if (body) {
    const insertAt = body.index + body[0].length;
    return `${withoutExisting.slice(0, insertAt)}\n  ${tag}${withoutExisting.slice(insertAt)}`;
  }

  return `${tag}${withoutExisting}`;
}

export function removeBrandLogo(html: string): string {
  return html ? html.replace(EXISTING_LOGO, '') : html;
}

export interface BrandLogoPreviewUrls {
  logoUrl?: string;
  logoDarkUrl?: string;
  logoWideUrl?: string;
  logoWideDarkUrl?: string;
}

/**
 * The branding URL each cid falls back through, in the order the send-time pass
 * walks the uploaded variants: a tenant who never uploaded the dark wordmark
 * still gets a logo rather than a hole.
 */
const PREVIEW_URL_FALLBACKS: Record<EmailBrandingLogoVariant, (keyof BrandLogoPreviewUrls)[]> = {
  default: ['logoUrl'],
  dark: ['logoDarkUrl', 'logoUrl'],
  wide: ['logoWideUrl', 'logoUrl'],
  'wide-dark': ['logoWideDarkUrl', 'logoWideUrl', 'logoUrl'],
};

/**
 * Previews render in an iframe that resolves `/api/documents/view/...` against
 * the app origin, so the `cid:` the row carries is swapped back to the branding
 * URL there. Nothing is embedded in a preview. Pure string work: no DOM, so the
 * settings panel and the template editor share it.
 */
export function resolveBrandLogoForPreview(html: string, urls: BrandLogoPreviewUrls): string {
  if (!html || !html.includes(BRAND_LOGO_MARKER)) return html;

  return html.replace(MARKER_TAG, (tag) => {
    const variant = parseBrandLogoVariant(readImgSrc(tag));
    if (!variant) return tag;

    const url = PREVIEW_URL_FALLBACKS[variant].map((key) => urls[key]).find(Boolean);
    return url ? withImgSrc(tag, url) : tag;
  });
}

/**
 * The one rule for which logo file a branded template references: the shape the
 * tenant picked, in the artwork that reads on the header the palette paints.
 *
 * Shared by the settings preview, the apply decorator and their tests, so what
 * a tenant sees in the panel is exactly what lands in tenant_email_templates.
 * Returns null when nothing usable is uploaded, which the callers read as "no
 * logo in this template" rather than writing a cid with no bytes behind it.
 */
export function pickBrandLogoVariant(
  shape: EmailBrandingLogoShape,
  headerIsDark: boolean,
  uploaded: BrandLogoPreviewUrls,
): EmailBrandingLogoVariant | null {
  if (shape === 'wide' && headerIsDark && uploaded.logoWideDarkUrl) return 'wide-dark';
  if (shape === 'wide' && uploaded.logoWideUrl) return 'wide';
  if (headerIsDark && uploaded.logoDarkUrl) return 'dark';
  return uploaded.logoUrl ? 'default' : null;
}

const ATTRIBUTION = 'Powered by AlgaPSA';
const SEPARATOR = '(?:&middot;|&#183;|·|•)';

/**
 * Drops the attribution line and whatever separator holds it to the rest of the
 * footer, in both shapes the templates ship: leading
 * "Powered by AlgaPSA &middot; Keeping teams aligned" and trailing
 * "&copy; 2026 Acme &middot; Powered by AlgaPSA", plus the standalone
 * <p>Powered by AlgaPSA</p> that portal-invitation carries.
 */
export function stripBrandAttribution(html: string): string {
  if (!html) return html;

  return html
    .replace(new RegExp(`<p>\\s*${ATTRIBUTION}\\s*</p>`, 'gi'), '')
    .replace(new RegExp(`\\s*${SEPARATOR}\\s*${ATTRIBUTION}`, 'gi'), '')
    .replace(new RegExp(`${ATTRIBUTION}\\s*${SEPARATOR}\\s*`, 'gi'), '')
    .replace(new RegExp(ATTRIBUTION, 'gi'), '');
}

export function containsBrandAttribution(html: string): boolean {
  return !!html && html.includes(ATTRIBUTION);
}

/** The Enterprise pass the apply flow runs over every HTML it writes. */
export function decorateBrandedHtml(html: string, options: BrandDecorationOptions): string {
  let result = options.logo ? applyBrandLogo(html, options.logo) : removeBrandLogo(html);
  if (options.hideAttribution) result = stripBrandAttribution(result);
  return result;
}
