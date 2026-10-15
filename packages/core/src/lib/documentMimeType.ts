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

