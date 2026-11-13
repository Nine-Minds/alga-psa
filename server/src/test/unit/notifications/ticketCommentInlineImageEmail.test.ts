import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@alga-psa/storage/StorageService', () => ({
  StorageService: {
    downloadFile: vi.fn(),
  },
}));
import { StorageService } from '@alga-psa/storage/StorageService';
import { getTenantContext } from '@alga-psa/db';
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

  const db = vi.fn().mockImplementation((table: string) => table === 'ticket_comment_attachments'
    ? { ...builder, select: vi.fn().mockResolvedValue([]) } : builder);
  return { db: db as any, builder };
}

describe('ticketCommentInlineImageEmail', () => {
  const authorized = async () => true;
  const missingImageText = '[Image not included]';

  afterEach(() => {
    // Vitest 4's restoreAllMocks only restores vi.spyOn spies; reset the
    // vi.fn() module mocks too so call history cannot leak between tests.
    vi.resetAllMocks();
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

    vi.spyOn(StorageService, 'downloadFile').mockImplementation(async () => {
      expect(getTenantContext()).toBe('tenant-1');
      return {
        buffer: Buffer.from('png-bytes'),
        metadata: {
          original_name: 'clipboard-image.png',
          mime_type: 'image/png',
          size: 9,
        },
      };
    });

    const result = await rewriteTicketCommentImagesToCid({
      db,
      tenantId: 'tenant-1',
      ticketId: 'ticket-1',
      html: '<p>Hello<img src="/api/documents/view/file-1" /></p>',
      authorizeDocument: authorized,
      missingImageText,
      allowInlineImages: true,
      supportsAttachments: true,
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

  it('T018: shows a marker instead of an authenticated URL when CID generation fails', async () => {
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
      authorizeDocument: authorized,
      missingImageText,
      allowInlineImages: true,
      supportsAttachments: true,
    });

    expect(result.attachments).toHaveLength(0);
    expect(result.html).toContain(missingImageText);
    expect(result.html).not.toContain('/api/documents/view/file-1');
    expect(result.outcomes).toEqual([
      expect.objectContaining({
        sourceUrl: '/api/documents/view/file-1',
        resolvedFileId: 'file-1',
        strategy: 'placeholder',
        reason: 'storage_download_failed',
      }),
    ]);
  });

  it('shows a marker when an inline image exceeds the per-image limit', async () => {
    const { db } = createMockDb([
      {
        document_id: 'doc-1',
        document_name: 'big-image.png',
        file_id: 'file-1',
        mime_type: 'image/png',
        file_size: 1024,
      },
    ]);

    const downloadSpy = vi.spyOn(StorageService, 'downloadFile').mockResolvedValue({
      buffer: Buffer.from('unused'),
      metadata: {
        original_name: 'big-image.png',
        mime_type: 'image/png',
        size: 6,
      },
    });

    const html = '<p>Hello<img src="/api/documents/view/file-1" /></p>';
    const result = await rewriteTicketCommentImagesToCid({
      db,
      tenantId: 'tenant-1',
      ticketId: 'ticket-1',
      html,
      authorizeDocument: authorized,
      missingImageText,
      allowInlineImages: true,
      supportsAttachments: true,
      limits: {
        maxInlineImageBytes: 10,
        maxInlineImageTotalBytes: 100,
        maxInlineImageCount: 5,
      },
    });

    expect(result.attachments).toHaveLength(0);
    expect(result.html).toContain(missingImageText);
    expect(result.html).not.toContain('/api/documents/view/file-1');
    expect(result.outcomes).toEqual([
      expect.objectContaining({
        sourceUrl: '/api/documents/view/file-1',
        resolvedFileId: 'file-1',
        strategy: 'placeholder',
        reason: 'attachment_over_max_bytes',
      }),
    ]);
    expect(downloadSpy).not.toHaveBeenCalled();
  });

  it('shows a marker when cumulative image bytes exceed the total limit', async () => {
    const { db } = createMockDb([
      {
        document_id: 'doc-1',
        document_name: 'img-1.png',
        file_id: 'file-1',
        mime_type: 'image/png',
        file_size: 4,
      },
      {
        document_id: 'doc-2',
        document_name: 'img-2.png',
        file_id: 'file-2',
        mime_type: 'image/png',
        file_size: 4,
      },
    ]);

    vi.spyOn(StorageService, 'downloadFile').mockImplementation(async (fileId: string) => ({
      buffer: Buffer.from(fileId === 'file-1' ? 'aaaa' : 'bbbb'),
      metadata: {
        original_name: `${fileId}.png`,
        mime_type: 'image/png',
        size: 4,
      },
    }));

    const result = await rewriteTicketCommentImagesToCid({
      db,
      tenantId: 'tenant-1',
      ticketId: 'ticket-1',
      html: '<p><img src="/api/documents/view/file-1" /><img src="/api/documents/view/file-2" /></p>',
      authorizeDocument: authorized,
      missingImageText,
      allowInlineImages: true,
      supportsAttachments: true,
      limits: {
        maxInlineImageBytes: 10,
        maxInlineImageTotalBytes: 6,
        maxInlineImageCount: 5,
      },
    });

    expect(result.attachments).toHaveLength(1);
    expect(result.html).toContain('src="cid:ticket-comment-ticket-1-file-1-1@alga-psa"');
    expect(result.html).toContain(missingImageText);
    expect(result.html).not.toContain('/api/documents/view/file-2');
    expect(result.outcomes).toEqual([
      expect.objectContaining({
        sourceUrl: '/api/documents/view/file-1',
        resolvedFileId: 'file-1',
        strategy: 'cid',
        reason: 'converted_to_cid',
      }),
      expect.objectContaining({
        sourceUrl: '/api/documents/view/file-2',
        resolvedFileId: 'file-2',
        strategy: 'placeholder',
        reason: 'attachment_total_bytes_exceeded',
      }),
    ]);
  });

  it('does not download denied documents and escapes the marker in HTML', async () => {
    const { db } = createMockDb([{
      document_id: 'doc-1',
      document_name: 'private.png',
      file_id: 'file-1',
      mime_type: 'image/png',
    }]);
    const authorizeDocument = vi.fn().mockResolvedValue(false);

    const result = await rewriteTicketCommentImagesToCid({
      db,
      tenantId: 'tenant-1',
      ticketId: 'ticket-1',
      html: '<p><img src="/api/documents/view/file-1" /><img src="https://example.test/public.png" /></p>',
      authorizeDocument,
      missingImageText: '[Image <not included>]',
      allowInlineImages: true,
      supportsAttachments: true,
    });

    expect(authorizeDocument).toHaveBeenCalledWith('doc-1', expect.objectContaining({ file_id: 'file-1' }));
    expect(StorageService.downloadFile).not.toHaveBeenCalled();
    expect(result.attachments).toEqual([]);
    expect(result.html).toContain('[Image &lt;not included&gt;]');
    expect(result.html).toContain('src="https://example.test/public.png"');
    expect(result.html).not.toContain('file-1');
    expect(result.outcomes).toContainEqual(expect.objectContaining({
      strategy: 'placeholder',
      reason: 'authorization_denied',
    }));
  });

  it('authorizes encoded document-view paths instead of treating them as external images', async () => {
    const { db } = createMockDb([{
      document_id: 'doc-1',
      document_name: 'private.png',
      file_id: 'file-1',
      mime_type: 'image/png',
    }]);
    const authorizeDocument = vi.fn().mockResolvedValue(false);

    const result = await rewriteTicketCommentImagesToCid({
      db,
      tenantId: 'tenant-1',
      ticketId: 'ticket-1',
      html: '<img src="https://alga.test/api/%64ocuments/view/file-1" />',
      authorizeDocument,
      missingImageText,
      allowInlineImages: true,
      supportsAttachments: true,
    });

    expect(authorizeDocument).toHaveBeenCalledWith('doc-1', expect.objectContaining({ file_id: 'file-1' }));
    expect(result.html).toContain(missingImageText);
    expect(result.html).not.toContain('file-1');
    expect(result.attachments).toEqual([]);
    expect(StorageService.downloadFile).not.toHaveBeenCalled();
  });

  it('does not pass through other protected document routes as external image URLs', async () => {
    const { db } = createMockDb([]);
    const authorizeDocument = vi.fn();
    const result = await rewriteTicketCommentImagesToCid({
      db, tenantId: 'tenant-1', ticketId: 'ticket-1',
      html: '<img src="https://alga.test/api/documents/document-1/preview">' +
        '<img src="https://alga.test/api/client-portal/%64ocuments/document-2/file">' +
        '<img src="https://example.test/public.png">',
      authorizeDocument, missingImageText, allowInlineImages: true, supportsAttachments: true,
    });

    expect(result.html.match(/\[Image not included\]/g)).toHaveLength(2);
    expect(result.html).not.toMatch(/document-1|document-2/);
    expect(result.html).toContain('src="https://example.test/public.png"');
    expect(result.outcomes.filter(outcome => outcome.reason === 'unverified_document_url')).toHaveLength(2);
    expect(result.attachments).toEqual([]);
    expect(db).not.toHaveBeenCalled();
    expect(authorizeDocument).not.toHaveBeenCalled();
    expect(StorageService.downloadFile).not.toHaveBeenCalled();
  });

  it('shares one CID attachment when multiple URL forms reference the same document', async () => {
    const { db } = createMockDb([{
      document_id: 'doc-1',
      document_name: 'image.png',
      file_id: 'file-1',
      mime_type: 'image/png',
    }]);
    vi.spyOn(StorageService, 'downloadFile').mockResolvedValue({
      buffer: Buffer.from('image'),
      metadata: { original_name: 'image.png', mime_type: 'image/png', size: 5 },
    });
    const authorizeDocument = vi.fn().mockResolvedValue(true);

    const result = await rewriteTicketCommentImagesToCid({
      db,
      tenantId: 'tenant-1',
      ticketId: 'ticket-1',
      html: '<img src="/api/documents/view/file-1" /><img src="https://alga.test/api/documents/view/file-1" />',
      authorizeDocument,
      missingImageText,
      allowInlineImages: true,
      supportsAttachments: true,
    });

    expect(result.attachments).toHaveLength(1);
    expect(StorageService.downloadFile).toHaveBeenCalledTimes(1);
    expect(authorizeDocument).toHaveBeenCalledTimes(1);
    expect(result.html.match(/src="cid:ticket-comment-ticket-1-file-1-1@alga-psa"/g)).toHaveLength(2);
  });

  it('shows a marker when the provider cannot send attachments', async () => {
    const { db } = createMockDb([{
      document_id: 'doc-1',
      document_name: 'image.png',
      file_id: 'file-1',
      mime_type: 'image/png',
    }]);
    const result = await rewriteTicketCommentImagesToCid({
      db,
      tenantId: 'tenant-1',
      ticketId: 'ticket-1',
      html: '<img src="/api/documents/view/file-1" />',
      authorizeDocument: authorized,
      missingImageText,
      allowInlineImages: true,
      supportsAttachments: false,
    });

    expect(result.html).toContain(missingImageText);
    expect(result.attachments).toEqual([]);
    expect(StorageService.downloadFile).not.toHaveBeenCalled();
    expect(result.outcomes).toContainEqual(expect.objectContaining({
      strategy: 'placeholder',
      reason: 'attachments_not_supported',
    }));
  });

  it('suppresses managed, external, data and CID images before authorization for a non-internal audience', async () => {
    const { db } = createMockDb([]);
    const authorizeDocument = vi.fn();
    const result = await rewriteTicketCommentImagesToCid({
      db, tenantId: 'tenant-1', ticketId: 'ticket-1',
      html: '<img src="/api/documents/view/file-1"><img src="https://example.test/a.png">' +
        '<img src="data:image/png;base64,YQ=="><img src="cid:old-image">',
      authorizeDocument, missingImageText, allowInlineImages: false, supportsAttachments: true,
    });

    expect(result.html.match(/\[Image not included\]/g)).toHaveLength(4);
    expect(result.html).not.toContain('<img');
    expect(result.outcomes).toHaveLength(4);
    expect(result.outcomes.every(outcome => outcome.reason === 'audience_not_internal')).toBe(true);
    expect(result.attachments).toEqual([]);
    expect(db).not.toHaveBeenCalled();
    expect(authorizeDocument).not.toHaveBeenCalled();
    expect(StorageService.downloadFile).not.toHaveBeenCalled();
  });

  it('extractDocumentViewFileId parses relative and absolute document-view URLs', () => {
    expect(extractDocumentViewFileId('/api/documents/view/file-abc')).toBe('file-abc');
    expect(extractDocumentViewFileId('https://acme.example.com/api/documents/view/file-def?x=1')).toBe(
      'file-def'
    );
    expect(extractDocumentViewFileId('/api/%64ocuments/view/file-abc')).toBe('file-abc');
    expect(extractDocumentViewFileId('/api/documents/view/file-abc/')).toBe('file-abc');
    expect(extractDocumentViewFileId('https://acme.example.com/api%2Fdocuments%2Fview%2Ffile-def')).toBe(
      'file-def'
    );
    expect(extractDocumentViewFileId('https://acme.example.com/not-documents/view/file-def')).toBeNull();
    expect(extractDocumentViewFileId('/api/documents/document-1/preview')).toBeNull();
  });
});
