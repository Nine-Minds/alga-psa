export interface DocumentViewUrlInput {
  document_id?: string | null;
  file_id?: string | null;
}

type DocumentViewUrlResolver = (document: {
  document_id?: string;
  file_id?: string;
}) => string;

/**
 * Resolve the URL used to view a ticket document.
 *
 * Documents with an associated file are served from storage. In-app / block
 * documents have no file, so requesting file content (e.g.
 * `/api/documents/download/<id>`) fails with "Document has no associated
 * file"; open those in the documents viewer instead.
 */
export function resolveDocumentViewUrl(input: DocumentViewUrlInput): string {
  if (input.file_id) {
    return `/api/documents/view/${input.file_id}`;
  }
  return `/msp/documents?doc=${input.document_id}`;
}

/**
 * Resolve the URL a ticket-grid document row links to.
 *
 * A host resolver (e.g. the client portal) may override the URL for
 * file-backed documents; file-less documents always open in the documents
 * viewer so we never request missing file content.
 */
export function documentViewUrl(
  doc: Pick<DocumentViewUrlInput, 'document_id' | 'file_id'>,
  resolve?: DocumentViewUrlResolver,
): string {
  if (doc.file_id && resolve) {
    return resolve({
      document_id: doc.document_id ?? undefined,
      file_id: doc.file_id ?? undefined,
    });
  }
  return resolveDocumentViewUrl(doc);
}
