/**
 * Whether `/api/documents/view/<file_id>` will serve a file inline. Mirrors the
 * gate in that route: anything else is answered with 400, so links for other
 * types (audio voicemails, archives, office files) must go to the download route.
 */
export function isPreviewableDocumentMimeType(mimeType?: string | null): boolean {
    const normalized = (mimeType || '').trim().toLowerCase();
    if (!normalized) return false;
    return (
        normalized.startsWith('image/') ||
        normalized.startsWith('video/') ||
        normalized === 'application/pdf'
    );
}

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

