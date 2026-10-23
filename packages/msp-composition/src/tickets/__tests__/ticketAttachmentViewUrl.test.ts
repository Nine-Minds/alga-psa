import { describe, it, expect } from 'vitest';
import { resolveTicketAttachmentViewUrl } from '../ticketAttachmentViewUrl';

describe('resolveTicketAttachmentViewUrl', () => {
  it('views a file-backed document by its file id', () => {
    expect(resolveTicketAttachmentViewUrl({ document_id: 'doc-1', file_id: 'file-1', mime_type: 'application/pdf' })).toBe(
      '/api/documents/view/file-1',
    );
  });

  it.each(['audio/wav', 'application/zip', undefined])('downloads files that cannot be previewed (%s)', (mime_type) => {
    expect(resolveTicketAttachmentViewUrl({ document_id: 'doc-1', file_id: 'file-1', mime_type })).toBe(
      '/api/documents/download/file-1',
    );
  });

  it('opens an in-app document in the viewer instead of requesting file content', () => {
    const url = resolveTicketAttachmentViewUrl({ document_id: 'doc-2' });
    expect(url).not.toContain('/api/documents/download/');
    expect(url).toBe('/msp/documents?doc=doc-2');
  });
});
