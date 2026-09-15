/**
 * Enterprise brand assets in email templates: the tenant's logo in the header
 * and the "Powered by AlgaPSA" footer line.
 *
 * Both passes are idempotent and run after the color rewrite, so applying twice
 * leaves exactly one logo and one footer.
 */

export const BRAND_LOGO_MARKER = 'data-alga-brand-logo';

const EXISTING_LOGO = new RegExp(`<img\\b[^>]*${BRAND_LOGO_MARKER}[^>]*>\\s*`, 'gi');

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

export interface BrandLogo {
  url: string;
  alt?: string;
}

export interface BrandDecorationOptions {
  logo?: BrandLogo;
  hideAttribution?: boolean;
}

function logoTag(logo: BrandLogo): string {
  return `<img ${BRAND_LOGO_MARKER} src="${escapeAttribute(logo.url)}" alt="${escapeAttribute(logo.alt ?? '')}" style="max-height:40px;margin-bottom:12px"/>`;
}

/**
 * Puts the tenant's logo at the top of the card: inside the gradient header
 * cell for the shared layout, or before the first heading for the auth
 * templates that bring their own structure.
 */
export function applyBrandLogo(html: string, logo: BrandLogo): string {
  if (!html || !logo?.url) return html;

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
