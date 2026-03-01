import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../lib/storage/StorageService', () => ({
  StorageService: {
    downloadFile: vi.fn(),
  },
}));
import { StorageService } from '../../../lib/storage/StorageService';
import {
  extractDocumentViewFileId,
  rewriteTicketCommentImagesToCid,
} from '../../../lib/eventBus/subscribers/ticketCommentInlineImageEmail';

function createMockDb(rows: any[]) {
  const builder = {
    join: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    whereIn: vi.fn().mockReturnThis(),
    andWhere: vi.fn().mockReturnThis(),
    select: vi.fn().mockResolvedValue(rows),
  };

  const db = vi.fn().mockImplementation(() => builder);
  return { db: db as any, builder };
}

describe('ticketCommentInlineImageEmail', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('T015/T016/T017: maps ticket attachment image URLs to CID attachments and rewrites HTML src', async () => {
    const { db } = createMockDb([
      {
        document_id: 'doc-1',
        document_name: 'clipboard-image.png',
        file_id: 'file-1',
        mime_type: 'image/png',
      },
    ]);

    vi.spyOn(StorageService, 'downloadFile').mockResolvedValue({
      buffer: Buffer.from('png-bytes'),
      metadata: {
        original_name: 'clipboard-image.png',
        mime_type: 'image/png',
        size: 9,
      },
    });

    const result = await rewriteTicketCommentImagesToCid({
      db,
      tenantId: 'tenant-1',
      ticketId: 'ticket-1',
      html: '<p>Hello<img src="/api/documents/view/file-1" /></p>',
    });

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]?.cid).toContain('ticket-comment-ticket-1-file-1');
    expect(result.html).toContain('src="cid:ticket-comment-ticket-1-file-1-1@alga-psa"');
    expect(result.outcomes).toEqual([
      expect.objectContaining({
        sourceUrl: '/api/documents/view/file-1',
        resolvedFileId: 'file-1',
        strategy: 'cid',
        reason: 'converted_to_cid',
      }),
    ]);
  });

  it('T018: falls back to original URL when CID generation fails', async () => {
    const { db } = createMockDb([
      {
        document_id: 'doc-1',
        document_name: 'clipboard-image.png',
        file_id: 'file-1',
        mime_type: 'image/png',
      },
    ]);

    vi.spyOn(StorageService, 'downloadFile').mockRejectedValue(new Error('download failure'));

    const html = '<p>Hello<img src="/api/documents/view/file-1" /></p>';
    const result = await rewriteTicketCommentImagesToCid({
      db,
      tenantId: 'tenant-1',
      ticketId: 'ticket-1',
      html,
    });

    expect(result.attachments).toHaveLength(0);
    expect(result.html).toContain('src="/api/documents/view/file-1"');
    expect(result.outcomes).toEqual([
      expect.objectContaining({
        sourceUrl: '/api/documents/view/file-1',
        resolvedFileId: 'file-1',
        strategy: 'url-fallback',
        reason: 'storage_download_failed',
      }),
    ]);
  });

  it('extractDocumentViewFileId parses relative and absolute document-view URLs', () => {
    expect(extractDocumentViewFileId('/api/documents/view/file-abc')).toBe('file-abc');
    expect(extractDocumentViewFileId('https://acme.example.com/api/documents/view/file-def?x=1')).toBe(
      'file-def'
    );
    expect(extractDocumentViewFileId('https://acme.example.com/not-documents/view/file-def')).toBeNull();
  });
});
