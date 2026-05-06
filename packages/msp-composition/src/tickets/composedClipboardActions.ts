'use server';

import { deleteDocument } from '@alga-psa/documents/actions/documentActions';
import { uploadDocument } from '@alga-psa/documents/actions/documentActions';
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

/**
 * Composed ticket attachment upload for ticket/comment rich-text flows.
 */
export async function uploadTicketAttachmentDocument(
  formData: FormData,
  params: { userId: string; ticketId: string }
) {
  return uploadDocument(formData, params);
}

export function resolveTicketAttachmentViewUrl(input: {
  document_id?: string;
  file_id?: string;
}) {
  if (input.file_id) {
    return `/api/documents/view/${input.file_id}`;
  }
  return `/api/documents/download/${input.document_id}`;
}
