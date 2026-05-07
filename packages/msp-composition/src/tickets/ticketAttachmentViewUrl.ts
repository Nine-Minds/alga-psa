export function resolveTicketAttachmentViewUrl(input: {
  document_id?: string;
  file_id?: string;
}) {
  if (input.file_id) {
    return `/api/documents/view/${input.file_id}`;
  }
  return `/api/documents/download/${input.document_id}`;
}
