import { resolveDocumentServingPolicy, isInlineTextDocumentMimeType } from './documentServingPolicy';

/**
 * Whether `/api/documents/view/<file_id>` will serve a file. Thin alias of the
 * serving policy's `servable`; links for other types (audio voicemails,
 * archives, office files) must go to the download route.
 */
export function isPreviewableDocumentMimeType(mimeType?: string | null): boolean {
    return resolveDocumentServingPolicy(mimeType).servable;
}

export { isInlineTextDocumentMimeType };
