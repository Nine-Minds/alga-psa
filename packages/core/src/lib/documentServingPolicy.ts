const INLINE_TEXT_MIME_TYPES = new Set(['text/plain', 'text/markdown', 'text/csv']);

/**
 * Whether a text file's bytes are safe to read back and render as plain text.
 * Deliberately excludes markup types (`text/html`, `text/xml`, SVG) because
 * those execute when a browser renders them.
 */
export function isInlineTextDocumentMimeType(mimeType?: string | null): boolean {
  const normalized = (mimeType || '').trim().toLowerCase().split(';')[0].trim();
  if (!normalized) return false;
  return INLINE_TEXT_MIME_TYPES.has(normalized);
}

export type DocumentDisposition = 'inline' | 'attachment';

export interface DocumentServingPolicy {
  /** The MIME type after trim / lowercase / `;params` stripping. */
  mimeType: string;
  /** May `/api/documents/view` stream these bytes at all? */
  servable: boolean;
  /** May the browser render these bytes as our origin? Anything unsure is `attachment`. */
  disposition: DocumentDisposition;
  /** Response headers every route serving these bytes must send. */
  headers: Record<string, string>;
}

const INLINE_CSP = "default-src 'none'; media-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox";

// A bare `sandbox` gives a top-level media document an opaque origin, so its own
// Range sub-requests are cross-site and lose the SameSite=Lax session cookie.
// `allow-same-origin` keeps the origin; scripts stay blocked (no `allow-scripts`),
// and video bytes are never markup, so nothing can execute.
const INLINE_VIDEO_CSP = "default-src 'none'; media-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox allow-same-origin";

function normalizeMimeType(mimeType?: string | null): string {
  return (mimeType || '').split(';')[0].trim().toLowerCase();
}

/**
 * The single document-serving policy. "May we stream this?" (`servable`) and
 * "may the browser render this as our origin?" (`disposition`) are separate
 * questions: SVG and other markup are servable but never inline, because
 * rendering them executes script on the AlgaPSA origin.
 */
export function resolveDocumentServingPolicy(mimeType?: string | null): DocumentServingPolicy {
  const normalized = normalizeMimeType(mimeType);

  const servable =
    normalized.startsWith('image/') ||
    normalized.startsWith('video/') ||
    normalized === 'application/pdf';

  const inline =
    normalized === 'application/pdf' ||
    (normalized.startsWith('image/') && normalized !== 'image/svg+xml') ||
    normalized.startsWith('video/') ||
    isInlineTextDocumentMimeType(normalized);

  const disposition: DocumentDisposition = inline ? 'inline' : 'attachment';
  const headers: Record<string, string> = { 'X-Content-Type-Options': 'nosniff' };
  if (disposition === 'inline') headers['Content-Security-Policy'] = normalized.startsWith('video/') ? INLINE_VIDEO_CSP : INLINE_CSP;

  return { mimeType: normalized, servable, disposition, headers };
}

/** `Content-Disposition` value; with a filename it carries ASCII and RFC 5987 forms. */
export function buildContentDisposition(disposition: DocumentDisposition, filename?: string | null): string {
  if (!filename) return disposition;
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\;]/g, '_').replace(/[\r\n]/g, '_');
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
