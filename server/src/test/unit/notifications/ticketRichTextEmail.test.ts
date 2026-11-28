import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { knex } from 'knex';
import logger from '@alga-psa/core/logger';
import type { RewriteTicketCommentImagesResult, TicketInlineImageDocument } from '../../../lib/eventBus/subscribers/ticketCommentInlineImageEmail';

const state = vi.hoisted(() => ({
  comment: {
    thread_id: 'thread-1',
    note: JSON.stringify([{ type: 'image', props: { url: '/api/documents/view/file-1' } }]),
    publish_state: 'published',
    deleted_at: null as string | null,
    is_resolution: true,
  },
  hasThread: true,
  managed: false,
  ticket: { attributes: { description: 'A current ticket description' } },
  isPublic: vi.fn(),
  canReceiveInternal: vi.fn(),
  classifyRecipient: vi.fn(),
  authorizeDocument: vi.fn(),
  prepareManaged: vi.fn(),
  rewrite: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: (table: string) => ({
      where: () => ({
        first: async () => {
          if (table === 'comments') return state.comment;
          if (table === 'comment_threads') return state.hasThread ? { thread_id: 'thread-1' } : undefined;
          if (table === 'ticket_comment_attachments') return state.managed ? { comment_id: 'comment-1' } : undefined;
          if (table === 'tickets') return state.ticket;
          throw new Error(`Unexpected table: ${table}`);
        },
      }),
    }),
  }),
}));
vi.mock('@shared/lib/ticketCommentAttachments', () => ({
  isPublicAttachmentComment: state.isPublic,
}));
vi.mock('../../../lib/notifications/ticketCommentAttachmentEmail', () => ({
  authorizedRecipientTicketDocument: state.authorizeDocument,
  prepareCommentAttachmentEmail: state.prepareManaged,
  recipientCanReceiveInternalComment: state.canReceiveInternal,
  classifyTicketEmailRecipient: state.classifyRecipient,
}));
vi.mock('../../../lib/eventBus/subscribers/ticketCommentInlineImageEmail', () => ({
  extractDocumentViewFileId: (source: string) => source.endsWith('/file-1') ? 'file-1' : null,
  rewriteTicketCommentImagesToCid: state.rewrite,
}));

import {
  messageRecipients,
  resolveTicketEmailAudience,
  prepareTicketCommentRichTextEmail,
  prepareTicketDescriptionRichTextEmail,
  type TicketRichTextEmailInput,
} from '../../../lib/notifications/ticketRichTextEmail';

const db = knex({ client: 'pg' });
const document: TicketInlineImageDocument = {
  document_id: 'doc-1',
  document_name: 'image.png',
  file_id: 'file-1',
  mime_type: 'image/png',
  file_size: 4,
};

const input = (): TicketRichTextEmailInput => ({
  db,
  tenant: 'tenant-1',
  ticketId: 'ticket-1',
  commentId: 'comment-1',
  recipients: ['to@example.test', 'cc@example.test', 'bcc@example.test'],
  audience: 'public',
  allowInlineImages: true,
  suppressProtectedContent: false,
  requireResolution: true,
  capabilities: { supportsAttachments: true, maxAttachmentSize: 3_000_000 },
  baseUrl: 'https://alga.example.test',
  missingImageText: '[Image not included]',
  protectedContentText: '[Protected content not included]',
  unsupportedContentText: '[Unsupported content]',
});

beforeEach(() => {
  state.comment = {
    thread_id: 'thread-1',
    note: JSON.stringify([{ type: 'image', props: { url: '/api/documents/view/file-1' } }]),
    publish_state: 'published',
    deleted_at: null,
    is_resolution: true,
  };
  state.hasThread = true;
  state.managed = false;
  state.ticket = { attributes: { description: 'A current ticket description' } };
  state.isPublic.mockReset().mockResolvedValue(true);
  state.canReceiveInternal.mockReset().mockResolvedValue(true);
  state.classifyRecipient.mockReset().mockResolvedValue('internal');
  state.authorizeDocument.mockReset().mockResolvedValue(document);
  state.prepareManaged.mockReset();
  state.rewrite.mockReset().mockImplementation(async (params: {
    html: string;
    authorizeDocument: (documentId: string, doc: TicketInlineImageDocument) => Promise<boolean>;
    missingImageText: string;
    allowInlineImages: boolean;
  }): Promise<RewriteTicketCommentImagesResult> => {
    if (!params.html.includes('<img')) return { html: params.html, attachments: [], outcomes: [] };
    if (!params.allowInlineImages) {
      return {
        html: `<span>${params.missingImageText}</span>`, attachments: [],
        outcomes: [{ sourceUrl: '/api/documents/view/file-1', strategy: 'placeholder', reason: 'audience_not_internal' }],
      };
    }
    const allowed = await params.authorizeDocument('doc-1', document);
    return {
      html: allowed ? '<img src="cid:image-1" />' : `<span>${params.missingImageText}</span>`,
      attachments: allowed ? [{ filename: 'image.png', content: Buffer.from('data'), cid: 'image-1' }] : [],
      outcomes: [{
        sourceUrl: '/api/documents/view/file-1',
        resolvedFileId: 'file-1',
        strategy: allowed ? 'cid' : 'placeholder',
        reason: allowed ? 'converted_to_cid' : 'authorization_denied',
      }],
    };
  });
});

afterAll(async () => { await db.destroy(); });

describe('ticket rich-text email delivery', () => {
  it('normalizes and deduplicates all message recipients, including Bcc', () => {
    expect(messageRecipients(' To@example.test ', [
      { email: 'cc@example.test' },
      { email: 'to@example.test' },
    ], [{ email: 'BCC@example.test' }])).toEqual(['to@example.test', 'cc@example.test', 'bcc@example.test']);
    expect(() => messageRecipients(' ', [], [])).toThrow(/recipient/);
  });

  it('classifies the complete audience for every source and destination ticket', async () => {
    const recipients = input().recipients;
    expect(await resolveTicketEmailAudience(db, 'tenant-1', ['ticket-1', 'child-1'], recipients))
      .toEqual({ allowInlineImages: true, suppressProtectedContent: false });
    expect(state.classifyRecipient).toHaveBeenCalledTimes(6);
    state.classifyRecipient.mockImplementation(async (_db, _tenant, _ticket, email) =>
      email === 'bcc@example.test' ? 'external' : 'internal');
    expect(await resolveTicketEmailAudience(db, 'tenant-1', ['ticket-1'], recipients))
      .toEqual({ allowInlineImages: false, suppressProtectedContent: true });
    state.classifyRecipient.mockResolvedValue('external');
    expect(await resolveTicketEmailAudience(db, 'tenant-1', ['ticket-1'], recipients))
      .toEqual({ allowInlineImages: false, suppressProtectedContent: false });
    state.classifyRecipient.mockResolvedValue('unknown');
    expect(await resolveTicketEmailAudience(db, 'tenant-1', ['ticket-1'], recipients))
      .toEqual({ allowInlineImages: false, suppressProtectedContent: true });
    expect(await resolveTicketEmailAudience(db, 'tenant-1', [], recipients))
      .toEqual({ allowInlineImages: false, suppressProtectedContent: true });
  });

  it('omits images and media for mixed audiences while preserving ordinary text and links', async () => {
    state.comment.note = JSON.stringify([
      { type: 'paragraph', content: [
        { type: 'text', text: 'Keep this text ', styles: {} },
        { type: 'link', href: 'https://example.test/help', content: [{ type: 'text', text: 'Help', styles: {} }] },
      ] },
      { type: 'image', props: { url: 'data:image/png;base64,YQ==' } },
      { type: 'image', props: { url: 'https://example.test/private.png' } },
      { type: 'file', props: { url: 'https://example.test/private-file', name: 'Private file' } },
      { type: 'paragraph', content: [
        { type: 'link', href: '/api/documents/download/document-1', content: [{ type: 'text', text: 'Document', styles: {} }] },
      ] },
    ]);
    const result = await prepareTicketCommentRichTextEmail({
      ...input(), allowInlineImages: false, suppressProtectedContent: true,
    });

    expect(result?.html).toContain('Keep this text');
    expect(result?.html).toContain('https://example.test/help');
    expect(result?.html).toContain('[Image not included]');
    expect(result?.html).toContain('[Protected content not included]');
    expect(result?.html).not.toMatch(/<img|data:image|private\.png|private-file|\/api\/documents/i);
    expect(result?.text).not.toMatch(/data:image|private\.png|private-file|\/api\/documents/i);
    expect(result?.attachments).toEqual([]);
    expect(result?.rawContent).toBeNull();
    expect(state.authorizeDocument).not.toHaveBeenCalled();
  });

  it('requires every To, Cc and Bcc recipient to be authorized for each image', async () => {
    state.authorizeDocument.mockImplementation(async (_db, _tenant, _ticket, _document, recipient) =>
      recipient === 'cc@example.test' ? null : document);

    const prepared = await prepareTicketCommentRichTextEmail(input());
    expect(state.authorizeDocument.mock.calls.map(call => call[4])).toEqual([
      'to@example.test', 'cc@example.test', 'bcc@example.test',
    ]);
    expect(prepared?.html).toContain('[Image not included]');
    expect(prepared?.text).toContain('[Image not included]');
    expect(prepared?.text).not.toContain('/api/documents/view/file-1');
    expect(prepared?.attachments).toEqual([]);
    expect(prepared?.redacted).toBe(true);
    expect(prepared?.rawContent).toBeNull();
  });

  it('rechecks all recipients on a retry after document access is revoked', async () => {
    const first = await prepareTicketCommentRichTextEmail(input());
    expect(first?.html).toContain('cid:image-1');
    expect(first?.attachments).toHaveLength(1);

    state.authorizeDocument.mockImplementation(async (_db, _tenant, _ticket, _document, recipient) =>
      recipient === 'bcc@example.test' ? null : document);
    const retry = await prepareTicketCommentRichTextEmail(input());
    expect(retry?.html).toContain('[Image not included]');
    expect(retry?.attachments).toEqual([]);
  });

  it('omits a public resolution when it becomes private, deleted, unpublished or no longer a resolution', async () => {
    state.isPublic.mockResolvedValue(false);
    expect(await prepareTicketCommentRichTextEmail(input())).toBeNull();
    state.isPublic.mockResolvedValue(true);
    state.comment.deleted_at = '2026-01-01';
    expect(await prepareTicketCommentRichTextEmail(input())).toBeNull();
    state.comment.deleted_at = null;
    state.comment.publish_state = 'scheduled';
    expect(await prepareTicketCommentRichTextEmail(input())).toBeNull();
    state.comment.publish_state = 'published';
    state.comment.is_resolution = false;
    expect(await prepareTicketCommentRichTextEmail(input())).toBeNull();
  });

  it('only renders a private resolution when every recipient is authorized staff', async () => {
    state.isPublic.mockResolvedValue(false);
    state.canReceiveInternal.mockImplementation(async (_db, _tenant, _ticket, recipient) =>
      recipient !== 'bcc@example.test');
    expect(await prepareTicketCommentRichTextEmail({ ...input(), audience: 'authorized' })).toBeNull();

    state.canReceiveInternal.mockResolvedValue(true);
    expect((await prepareTicketCommentRichTextEmail({ ...input(), audience: 'authorized' }))?.attachments).toHaveLength(1);
  });

  it('honors reauthorized sponsor text access without granting document access', async () => {
    state.isPublic.mockResolvedValue(false);
    state.canReceiveInternal.mockResolvedValue(false);
    state.authorizeDocument.mockResolvedValue(null);
    const prepared = await prepareTicketCommentRichTextEmail({
      ...input(), audience: 'authorized', recipients: ['to@example.test'],
      authorizedSponsorRecipient: 'to@example.test',
    });
    expect(prepared?.html).toContain('[Image not included]');
    expect(prepared?.attachments).toEqual([]);
    expect(prepared?.rawContent).toBeNull();
  });

  it('redacts images when any recipient lacks access to a bundled destination ticket', async () => {
    const prepared = await prepareTicketCommentRichTextEmail({ ...input(), sharedDocumentAccess: false });
    expect(prepared?.html).toContain('[Image not included]');
    expect(prepared?.attachments).toEqual([]);
    expect(state.authorizeDocument).not.toHaveBeenCalled();
  });

  it('logs each inline image outcome without exposing its source URL', async () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    state.rewrite.mockResolvedValue({
      html: '<p>Images processed</p>',
      attachments: [],
      outcomes: [
        { sourceUrl: '/api/documents/view/file-1', resolvedFileId: 'file-1', strategy: 'cid', reason: 'converted_to_cid' },
        { sourceUrl: 'https://example.test/image', strategy: 'url-fallback', reason: 'not_document_view_url' },
        { sourceUrl: '/private-image', strategy: 'placeholder', reason: 'authorization_denied' },
      ],
    });

    try {
      await prepareTicketCommentRichTextEmail(input());
      const outcomes = info.mock.calls.filter(([message]) =>
        message === '[TicketEmailSubscriber] Comment inline image processing outcome');
      expect(outcomes).toHaveLength(3);
      expect(outcomes.map(([, fields]) => fields)).toEqual([
        { tenantId: 'tenant-1', ticketId: 'ticket-1', commentId: 'comment-1', resolvedFileId: 'file-1', strategy: 'cid', reason: 'converted_to_cid' },
        { tenantId: 'tenant-1', ticketId: 'ticket-1', commentId: 'comment-1', resolvedFileId: undefined, strategy: 'url-fallback', reason: 'not_document_view_url' },
        { tenantId: 'tenant-1', ticketId: 'ticket-1', commentId: 'comment-1', resolvedFileId: undefined, strategy: 'placeholder', reason: 'authorization_denied' },
      ]);
    } finally {
      info.mockRestore();
    }
  });

  it('logs image outcomes from ticket descriptions', async () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    state.rewrite.mockResolvedValue({
      html: '<p>Image processed</p>',
      attachments: [],
      outcomes: [{ sourceUrl: '/private-image', strategy: 'placeholder', reason: 'authorization_denied' }],
    });

    try {
      await prepareTicketDescriptionRichTextEmail({ ...input(), commentId: undefined });
      expect(info).toHaveBeenCalledWith('[TicketEmail] Description inline image processing outcome', {
        tenantId: 'tenant-1',
        ticketId: 'ticket-1',
        commentId: undefined,
        resolvedFileId: undefined,
        strategy: 'placeholder',
        reason: 'authorization_denied',
      });
    } finally {
      info.mockRestore();
    }
  });

  it('replaces unavailable non-document sources in the text alternative', async () => {
    state.comment.note = JSON.stringify([{ type: 'image', props: { url: '/private-image' } }]);
    state.rewrite.mockResolvedValue({
      html: '<span>[Image not included]</span>', attachments: [],
      outcomes: [{ sourceUrl: '/private-image', strategy: 'placeholder', reason: 'not_document_view_url' }],
    });
    const prepared = await prepareTicketCommentRichTextEmail(input());
    expect(prepared?.text).toContain('[Image not included]');
    expect(prepared?.text).not.toContain('/private-image');
  });

  it('reloads a ticket description and applies the same image authorization', async () => {
    state.ticket.attributes.description = JSON.stringify([
      { type: 'image', props: { url: '/api/documents/view/file-1' } },
    ]);
    state.authorizeDocument.mockImplementation(async (_db, _tenant, _ticket, _document, recipient) =>
      recipient === 'bcc@example.test' ? null : document);
    const { commentId: _commentId, requireResolution: _resolution, ...descriptionInput } = input();
    const prepared = await prepareTicketDescriptionRichTextEmail(descriptionInput);
    expect(prepared?.html).toContain('[Image not included]');
    expect(prepared?.text).not.toContain('/api/documents/view/file-1');
    expect(prepared?.attachments).toEqual([]);
  });

  it('rechecks the source comment when a description came from an initial comment', async () => {
    state.isPublic.mockResolvedValue(false);
    state.canReceiveInternal.mockResolvedValue(false);
    const { requireResolution: _resolution, ...descriptionInput } = input();
    expect(await prepareTicketDescriptionRichTextEmail({
      ...descriptionInput, audience: 'authorized',
    })).toBeNull();
  });

  it('passes the complete recipient set and localized markers to managed attachment preparation', async () => {
    state.managed = true;
    state.prepareManaged.mockResolvedValue({
      html: '<span>[Image non incluse]</span>',
      text: '[Image non incluse]',
      attachments: [],
      downloadLinks: [],
      redacted: true,
    });
    state.rewrite.mockResolvedValue({ html: '<span>[Image non incluse]</span>', attachments: [], outcomes: [] });
    const prepared = await prepareTicketCommentRichTextEmail({
      ...input(), missingImageText: '[Image non incluse]', unsupportedContentText: '[Contenu indisponible]',
    });

    expect(state.prepareManaged).toHaveBeenCalledWith(expect.objectContaining({
      recipients: ['to@example.test', 'cc@example.test', 'bcc@example.test'],
      missingImageText: '[Image non incluse]',
      renderOptions: expect.objectContaining({
        missingImagePlaceholder: '[Image non incluse]',
        unsupportedContentPlaceholder: '[Contenu indisponible]',
        onUnsupportedContent: expect.any(Function),
      }),
    }));
    expect(prepared?.managed).toBe(true);
    expect(prepared?.redacted).toBe(true);
  });

  it('logs the affected ticket and block type once when unsupported content is rendered', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    state.comment.note = JSON.stringify([{ type: 'unsupported-widget', props: {} }]);
    state.rewrite.mockResolvedValue({ html: '[Unsupported content]', attachments: [], outcomes: [] });
    try {
      await prepareTicketCommentRichTextEmail(input());
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith('[TicketEmail] Unsupported rich-text content was replaced', {
        tenantId: 'tenant-1', ticketId: 'ticket-1', commentId: 'comment-1', blockType: 'unsupported-widget',
      });
    } finally {
      warn.mockRestore();
    }
  });
});
