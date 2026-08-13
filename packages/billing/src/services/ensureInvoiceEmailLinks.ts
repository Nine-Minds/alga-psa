/**
 * Compatibility renderer for invoice emails.
 *
 * System and tenant-authored templates that predate the payment/portal link
 * variables get the missing CTAs appended after compilation. Exact-URL
 * detection means a template that adopts `invoice.paymentUrl` /
 * `invoice.portalUrl` renders its own buttons and never gets duplicates.
 */

export interface EnsureInvoiceEmailLinksInput {
  html: string;
  text: string;
  paymentUrl?: string;
  portalUrl?: string;
  labels?: {
    payNow?: string;
    viewInvoice?: string;
    textPayNow?: string;
    textViewInvoice?: string;
  };
}

const DEFAULT_LABELS = {
  payNow: 'Pay now',
  viewInvoice: 'View invoice in client portal',
  textPayNow: 'Pay your invoice online:',
  textViewInvoice: 'View your invoice in the client portal:',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Normalizes common HTML entities (including Handlebars' `&#x3D;` for `=`) so
 * a URL is detected regardless of which engine rendered it: Handlebars escapes
 * attribute URLs as entities in the direct action, while the scheduled
 * `EmailService` inserts them raw. Without this, a template that already
 * renders the URL would get a duplicate CTA.
 */
function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x3D;/gi, '=')
    .replace(/&#61;/gi, '=')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&apos;/gi, "'");
}

function containsUrl(haystack: string, url: string): boolean {
  return decodeHtmlEntities(haystack).includes(url);
}

function ctaBlockHtml(url: string, label: string): string {
  const escapedUrl = escapeHtml(url);
  return `
    <div style="margin:16px 0;text-align:center;">
      <a href="${escapedUrl}" style="background-color:#4f46e5;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">${escapeHtml(label)}</a>
    </div>`;
}

function insertBeforeBodyClose(html: string, block: string): string {
  const bodyClose = html.lastIndexOf('</body>');
  if (bodyClose === -1) {
    return `${html}\n${block}`;
  }
  return `${html.slice(0, bodyClose)}${block}\n${html.slice(bodyClose)}`;
}

/**
 * Appends missing payment and portal CTAs to already-rendered email HTML and
 * text. A URL already present in the content (escaped for HTML) is left
 * untouched, which avoids duplicate buttons once a template adopts the
 * variables.
 */
export function ensureInvoiceEmailLinks(input: EnsureInvoiceEmailLinksInput): {
  html: string;
  text: string;
} {
  const labels = { ...DEFAULT_LABELS, ...(input.labels ?? {}) };
  let { html, text } = input;
  const { paymentUrl, portalUrl } = input;

  if (paymentUrl && !containsUrl(html, paymentUrl)) {
    html = insertBeforeBodyClose(html, ctaBlockHtml(paymentUrl, labels.payNow));
  }
  if (portalUrl && !containsUrl(html, portalUrl)) {
    html = insertBeforeBodyClose(html, ctaBlockHtml(portalUrl, labels.viewInvoice));
  }

  if (paymentUrl && !containsUrl(text, paymentUrl)) {
    text = `${text}\n\n${labels.textPayNow} ${paymentUrl}`;
  }
  if (portalUrl && !containsUrl(text, portalUrl)) {
    text = `${text}\n\n${labels.textViewInvoice} ${portalUrl}`;
  }

  return { html, text };
}
