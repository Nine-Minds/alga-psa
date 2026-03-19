'use server';

import { deleteDocument } from '@alga-psa/documents/actions/documentActions';
import { deleteDraftClipboardImages as deleteDraftClipboardImagesCore } from '@alga-psa/tickets/actions/comment-actions/clipboardImageDraftActions';

/**
 * Composed version of deleteDraftClipboardImages that wires the
 * documents-package deleteDocument implementation.
 */
export async function deleteDraftClipboardImages(input: {
  ticketId: string;
  documentIds: string[];
}) {
  return deleteDraftClipboardImagesCore({
    ...input,
    deleteDocumentFn: deleteDocument,
  });
}
