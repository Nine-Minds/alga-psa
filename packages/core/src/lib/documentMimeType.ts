import { resolveDocumentServingPolicy } from './documentServingPolicy';

/**
 * Whether `/api/documents/view/<file_id>` will serve a file. Thin alias of the
 * serving policy's `servable`; links for other types (audio voicemails,
 * archives, office files) must go to the download route.
 */
export function isPreviewableDocumentMimeType(mimeType?: string | null): boolean {
    return resolveDocumentServingPolicy(mimeType).servable;
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

