import { isPreviewableDocumentMimeType } from '@alga-psa/documents/lib/documentUtils';

export interface DocumentViewUrlInput {
  document_id?: string | null;
  file_id?: string | null;
  mime_type?: string | null;
}

export interface DocumentViewUrlResolverInput {
  document_id?: string;
  file_id?: string;
  mime_type?: string;
}

type DocumentViewUrlResolver = (document: DocumentViewUrlResolverInput) => string;

/**
 * Resolve the URL used to open a ticket document.
 *
 * Documents with an associated file are served from storage: previewable
 * types (images, video, PDF) open inline via the view route, while anything
 * else (audio voicemails, archives, office files) goes to the download route
 * because the view route refuses those with 400. In-app / block documents
 * have no file, so requesting file content (e.g.
 * `/api/documents/download/<id>`) fails with "Document has no associated
 * file"; open those in the documents viewer instead.
 */
export function resolveDocumentViewUrl(input: DocumentViewUrlInput): string {
  if (input.file_id) {
    return isPreviewableDocumentMimeType(input.mime_type)
      ? `/api/documents/view/${input.file_id}`
      : `/api/documents/download/${input.file_id}`;
  }
  return `/msp/documents?doc=${input.document_id}`;
}

/**
 * Resolve the URL a ticket-grid document row links to.
 *
 * A host resolver (e.g. the client portal) may override the URL for
 * file-backed documents and receives the mime type so it can make the same
 * preview-vs-download decision; file-less documents always open in the
 * documents viewer so we never request missing file content.
 */
export function documentViewUrl(
  doc: Pick<DocumentViewUrlInput, 'document_id' | 'file_id' | 'mime_type'>,
  resolve?: DocumentViewUrlResolver,
): string {
  if (doc.file_id && resolve) {
    return resolve({
      document_id: doc.document_id ?? undefined,
      file_id: doc.file_id ?? undefined,
      mime_type: doc.mime_type ?? undefined,
    });
  }
  return resolveDocumentViewUrl(doc);
}
