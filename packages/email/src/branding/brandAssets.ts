/**
 * Enterprise brand assets in email templates: the tenant's logo in the header
 * and the "Powered by AlgaPSA" footer line.
 *
 * Both passes are idempotent and run after the color rewrite, so applying twice
 * leaves exactly one logo and one footer.
 */

import { LEGACY_BRAND_SLOGAN_PATTERN, stripOrphanedBrandFooter } from './orphanedSlogan';
import type { EmailBrandingLogoArtwork, EmailBrandingLogoShape, EmailBrandingLogoVariant } from './types';

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

export interface BrandDecorationOptions extends BrandAttributionStripOptions {
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
 * tenant picked, in the artwork that reads on the header the palette paints,
 * unless the tenant pinned the artwork — a mid grey sits on the luminance
 * boundary and only the tenant knows which wordmark they drew for it.
 *
 * Shared by the settings preview, the apply decorator, the send-time repair of
 * pre-cid rows and their tests, so what a tenant sees in the panel is exactly
 * what lands in tenant_email_templates. Returns null when nothing usable is
 * uploaded, which the callers read as "no logo in this template" rather than
 * writing a cid with no bytes behind it.
 */
export function pickBrandLogoVariant(
  shape: EmailBrandingLogoShape,
  headerIsDark: boolean,
  uploaded: BrandLogoPreviewUrls,
  artwork: EmailBrandingLogoArtwork = 'auto',
): EmailBrandingLogoVariant | null {
  const dark = artwork === 'auto' ? headerIsDark : artwork === 'dark';
  if (shape === 'wide' && dark && uploaded.logoWideDarkUrl) return 'wide-dark';
  if (shape === 'wide' && uploaded.logoWideUrl) return 'wide';
  if (dark && uploaded.logoDarkUrl) return 'dark';
  return uploaded.logoUrl ? 'default' : null;
}

/**
 * Every spelling the attribution has shipped in: the localized translations
 * write their own, and the pre-rename templates spell the product "Alga PSA".
 * None of them collide with a link or button label ("View in AlgaPSA").
 */
const ATTRIBUTION_PREFIXES = [
  'Powered by',
  'Drivs av',
  'Propulsé par',
  'Mogelijk gemaakt door',
  'Desenvolvido por',
  'Desarrollado por',
  'Bereitgestellt von',
];
const ATTRIBUTION = `(?:${ATTRIBUTION_PREFIXES.join('|')}) Alga\\s?PSA`;
const SEPARATOR = '(?:&middot;|&#183;|·|•)';

/**
 * The layout's footer row when the attribution opens it: the cell holds nothing
 * but the attribution and, after the separator, whatever tail the mode allows.
 */
const footerRow = (tail: string) => new RegExp(
  `<tr[^>]*>\\s*<td[^>]*>\\s*${ATTRIBUTION}(?:\\s*${SEPARATOR}\\s*${tail})?\\s*</td>\\s*</tr>`,
  'gi',
);
/** The same attribution-and-tail pair outside a row of its own. */
const attributionWithTail = (tail: string) =>
  new RegExp(`${ATTRIBUTION}\\s*${SEPARATOR}\\s*${tail}`, 'gi');

const ANY_TAIL_ROW = footerRow('[^<]*?');
const ANY_TAIL = attributionWithTail('[^<]*');
const SHIPPED_SLOGAN_ROW = footerRow(LEGACY_BRAND_SLOGAN_PATTERN);
const SHIPPED_SLOGAN = attributionWithTail(LEGACY_BRAND_SLOGAN_PATTERN);
const STANDALONE_PARAGRAPH = new RegExp(`<p>\\s*${ATTRIBUTION}\\s*</p>`, 'gi');
const TRAILING_ATTRIBUTION = new RegExp(`\\s*${SEPARATOR}\\s*${ATTRIBUTION}`, 'gi');
/**
 * The attribution and the separator that only joined it to what follows. Takes
 * the separator with it so a tail that stays — a line a tenant wrote beside the
 * attribution, which `shipped-slogan` keeps — does not open on a stray "&middot;".
 */
const ATTRIBUTION_WITH_SEPARATOR = new RegExp(`${ATTRIBUTION}\\s*${SEPARATOR}\\s*`, 'gi');
const BARE_ATTRIBUTION = new RegExp(ATTRIBUTION, 'gi');

export interface BrandAttributionStripOptions {
  /**
   * Which footer row counts as ours.
   * - `any-tail`, the default: the HTML being decorated is the standard
   *   template — a clone, a rebuild, the settings preview — so a footer row the
   *   attribution opens is ours by construction and goes whatever follows the
   *   separator, wording we have not shipped yet included.
   * - `shipped-slogan`, whenever the HTML passing through is a tenant's own row:
   *   only the footers we have actually shipped go. A footer reworded around the
   *   attribution ("Powered by AlgaPSA &middot; Acme MSP, your IT partner") then
   *   survives, instead of collapsing to the same nothing our footer does. The
   *   classifier reads it in this mode so such a row stays visibly the tenant's
   *   edit, and the apply decorates a ticked `customized` row in it so the words
   *   beside the attribution are not carried off with it.
   */
  footerRow?: 'any-tail' | 'shipped-slogan';
}

/**
 * Drops the attribution and everything that only exists to carry it, in every
 * shape the templates ship:
 * - the layout's own footer row, "Powered by AlgaPSA &middot; Keeping teams
 *   aligned" and its localized spellings, goes whole. The slogan is AlgaPSA's
 *   line, not the tenant's, so hiding the attribution hides it too instead of
 *   leaving an orphaned tagline; with the row gone there is no empty coloured
 *   band left behind either.
 * - a trailing "&copy; 2026 Acme &middot; Powered by AlgaPSA" loses only the
 *   attribution: the copyright is the tenant's.
 * - the standalone <p>Powered by AlgaPSA</p> older portal-invitation rows carry.
 * - anything else the attribution sits in loses the attribution and the
 *   separator behind it, and keeps the rest.
 *
 * Idempotent: a second pass has nothing left to match.
 */
export function stripBrandAttribution(html: string, options: BrandAttributionStripOptions = {}): string {
  if (!html) return html;

  const shippedOnly = options.footerRow === 'shipped-slogan';

  return html
    .replace(STANDALONE_PARAGRAPH, '')
    .replace(TRAILING_ATTRIBUTION, '')
    .replace(shippedOnly ? SHIPPED_SLOGAN_ROW : ANY_TAIL_ROW, '')
    .replace(shippedOnly ? SHIPPED_SLOGAN : ANY_TAIL, '')
    .replace(ATTRIBUTION_WITH_SEPARATOR, '')
    .replace(BARE_ATTRIBUTION, '');
}

export function containsBrandAttribution(html: string): boolean {
  return !!html && new RegExp(ATTRIBUTION, 'i').test(html);
}

/**
 * The Enterprise pass the apply flow runs over every HTML it writes.
 *
 * Hiding the attribution also repairs what an older strip left in a row this one
 * is rewriting. That matters for the one row the apply does not rebuild from the
 * standard template — a `customized` row the tenant ticked, recolored in place —
 * because the leftover carries no attribution for `stripBrandAttribution` to
 * recognize it by: the old strip took the attribution and kept the slogan. Left
 * to itself the apply would repaint that orphaned tagline in the tenant's new
 * palette and leave it standing (alga-2026-0003353). The repair is the same one
 * the classifier normalizes such a row with, so what we write back is what it
 * reads as ours.
 */
export function decorateBrandedHtml(html: string, options: BrandDecorationOptions): string {
  let result = options.logo ? applyBrandLogo(html, options.logo) : removeBrandLogo(html);
  if (options.hideAttribution) {
    result = stripOrphanedBrandFooter(stripBrandAttribution(result, { footerRow: options.footerRow }));
  }
  return result;
}
