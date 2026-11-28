import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { knex } from 'knex';

const state = vi.hoisted(() => ({
  comment: {
    thread_id: 'thread-1', note: '', publish_state: 'published',
    deleted_at: null as string | null, is_internal: false,
  },
  isPublic: true,
  documents: [{
    document_id: 'document-1', file_id: 'file-1', document_name: 'picture.png',
    mime_type: 'image/png', file_size: 100, is_client_visible: true,
  }],
  users: [] as Array<{ user_id: string; email: string; user_type: string; is_inactive: boolean }>,
  contacts: [] as Array<{ email: string }>,
  locations: [] as Array<{ email: string }>,
  allowedEmails: [] as string[],
  authorize: vi.fn(),
  download: vi.fn(),
  canAccess: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  runWithTenant: (_tenant: string, callback: () => unknown) => callback(),
  withTransaction: (db: unknown, callback: (trx: unknown) => unknown) => callback(db),
  tenantDb: () => ({
    tenantJoin: () => undefined,
    table: (table: string) => {
      let conditions: Record<string, unknown> = {};
      let email: string | undefined;
      const rows = () => {
        if (table === 'comments') return [state.comment];
        if (table === 'comment_threads') return [{ thread_id: 'thread-1', ticket_id: 'ticket-1' }];
        if (table === 'ticket_comment_attachments') return [{ comment_id: 'comment-1' }];
        if (table === 'ticket_comment_attachments as a') return state.documents;
        if (table === 'documents') return state.documents.filter(document =>
          !conditions.document_id || document.document_id === conditions.document_id);
        if (table === 'tickets') return [{ ticket_id: 'ticket-1', client_id: 'client-1', board_id: 'board-1' }];
        if (table === 'users') return state.users.filter(user =>
          (!email || user.email === email) &&
          (!conditions.user_type || user.user_type === conditions.user_type) &&
          (conditions.is_inactive === undefined || user.is_inactive === conditions.is_inactive));
        if (table === 'contacts') return state.contacts.filter(contact => !email || contact.email === email);
        if (table === 'client_locations') return state.locations.filter(location => !email || location.email === email);
        throw new Error(`Unexpected table: ${table}`);
      };
      const chain = {
        where: (value: Record<string, unknown>) => { conditions = { ...conditions, ...value }; return chain; },
        whereRaw: (_sql: string, bindings: string[]) => { email = bindings[0]; return chain; },
        select: () => chain,
        orderBy: () => chain,
        first: async () => rows()[0],
        then: (resolve: (value: unknown) => unknown) => resolve(rows()),
      };
      return chain;
    },
  }),
}));

vi.mock('@alga-psa/documents/actions/documentActions', () => ({
  authorizeAndRedactDocuments: state.authorize,
}));
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: async () => true }));
vi.mock('@alga-psa/storage/StorageService', () => ({ StorageService: { downloadFile: state.download } }));
vi.mock('@shared/lib/ticketCommentAttachments', () => ({
  listPublishedCommentAttachments: async () => state.documents,
  canAccessAttachmentTicket: state.canAccess,
  isPublicAttachmentComment: async () => state.isPublic,
}));

import {
  classifyTicketEmailRecipient,
  prepareCommentAttachmentEmail,
} from '../../../lib/notifications/ticketCommentAttachmentEmail';

const db = knex({ client: 'pg' });
const addresses = ['to@example.test', 'cc@example.test', 'bcc@example.test'];
const input = () => ({
  db, tenant: 'tenant-1', ticketId: 'ticket-1', commentId: 'comment-1',
  recipient: addresses[0], recipients: addresses, maxAttachmentBytes: 3_000_000,
  supportsAttachments: true, baseUrl: 'https://alga.example.test',
  allowInlineImages: true, suppressProtectedContent: false,
  missingImageText: '[Image non incluse]', protectedContentText: '[Contenu protege non inclus]',
  download: state.download,
});

beforeEach(() => {
  state.comment = {
    thread_id: 'thread-1',
    note: JSON.stringify([
      { type: 'paragraph', content: [{ type: 'text', text: 'Resolution details', styles: {} }] },
      { type: 'image', props: { url: '/api/documents/view/file-1', name: 'picture.png' } },
    ]),
    publish_state: 'published', deleted_at: null, is_internal: false,
  };
  state.isPublic = true;
  state.documents = [{
    document_id: 'document-1', file_id: 'file-1', document_name: 'picture.png',
    mime_type: 'image/png', file_size: 100, is_client_visible: true,
  }];
  state.users = addresses.map((email, index) => ({
    user_id: `user-${index}`, email, user_type: 'internal', is_inactive: false,
  }));
  state.allowedEmails = [...addresses];
  state.contacts = [];
  state.locations = [];
  state.authorize.mockReset().mockImplementation(async (_trx, _tenant, principal, docs) =>
    state.allowedEmails.includes(principal.email) ? docs : []);
  state.download.mockReset().mockResolvedValue({ buffer: Buffer.from('image bytes') });
  state.canAccess.mockReset().mockResolvedValue(true);
});

afterAll(async () => { await db.destroy(); });

describe('managed comment email attachments', () => {
  it('embeds the image once only after every recipient passes document authorization', async () => {
    const result = await prepareCommentAttachmentEmail(input());
    expect(state.authorize.mock.calls.map(call => call[2].email)).toEqual(addresses);
    expect(result.html).toContain('Resolution details');
    expect(result.html).toContain('src="cid:comment-comment-1-document-1@alga-psa"');
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].content).toEqual(Buffer.from('image bytes'));
    expect(result.redacted).toBe(false);
    expect(state.download).toHaveBeenCalledTimes(1);
  });

  it('embeds authorized document-ID image routes and redacts them when access is denied', async () => {
    state.comment.note = JSON.stringify([
      { type: 'image', props: { url: '/api/client-portal/%64ocuments/document-1/file', name: 'picture.png' } },
    ]);

    const allowed = await prepareCommentAttachmentEmail(input());
    expect(allowed.html).toContain('src="cid:comment-comment-1-document-1@alga-psa"');
    expect(allowed.attachments).toHaveLength(1);
    expect(allowed.html).not.toContain('document-1/file');

    state.allowedEmails = [addresses[0], addresses[2]];
    const denied = await prepareCommentAttachmentEmail(input());
    expect(denied.html).toContain('[Image non incluse]');
    expect(denied.text).toContain('[Image non incluse]');
    expect(denied.html).not.toContain('document-1');
    expect(denied.text).not.toContain('document-1');
    expect(denied.attachments).toEqual([]);
    expect(state.download).toHaveBeenCalledTimes(1);
  });

  it('replaces a denied Cc image in HTML and text without downloading it', async () => {
    state.allowedEmails = [addresses[0], addresses[2]];
    const result = await prepareCommentAttachmentEmail(input());
    expect(result.html).toContain('Resolution details');
    expect(result.html).toContain('[Image non incluse]');
    expect(result.text).toContain('[Image non incluse]');
    expect(result.html).not.toContain('file-1');
    expect(result.text).not.toContain('file-1');
    expect(result.attachments).toEqual([]);
    expect(result.redacted).toBe(true);
    expect(state.download).not.toHaveBeenCalled();
  });

  it('does not expose bytes when a document grant redacts the filename', async () => {
    state.authorize.mockImplementation(async (_trx, _tenant, principal, docs) =>
      principal.email === addresses[1] ? [{ ...docs[0], document_name: null }] : docs);
    const result = await prepareCommentAttachmentEmail(input());
    expect(result.html).toContain('[Image non incluse]');
    expect(result.attachments).toEqual([]);
    expect(state.download).not.toHaveBeenCalled();
  });

  it('redacts bundle images if destination access fails for any recipient', async () => {
    const result = await prepareCommentAttachmentEmail({ ...input(), sharedDocumentAccess: false });
    expect(result.html).toContain('[Image non incluse]');
    expect(result.attachments).toEqual([]);
    expect(state.authorize).not.toHaveBeenCalled();
  });

  it('permits a private image to authorized staff but suppresses it for a client', async () => {
    state.isPublic = false;
    state.comment.is_internal = true;
    state.users[1].user_type = 'client';
    const staff = await prepareCommentAttachmentEmail({
      ...input(), recipients: [addresses[0]], allowInternal: true,
    });
    const client = await prepareCommentAttachmentEmail({
      ...input(), recipient: addresses[1], recipients: [addresses[1]], allowInternal: true,
    });
    expect(staff.attachments).toHaveLength(1);
    expect(staff.html).toContain('src="cid:');
    expect(client.html).toBe('');
    expect(client.attachments).toEqual([]);
    expect(state.download).toHaveBeenCalledTimes(1);
  });

  it('uses a marker rather than a recipient-bound link for a shared oversized image', async () => {
    const result = await prepareCommentAttachmentEmail({ ...input(), supportsAttachments: false });
    expect(result.html).toContain('[Image non incluse]');
    expect(result.text).toContain('[Image non incluse]');
    expect(result.downloadLinks).toEqual([]);
    expect(result.attachments).toEqual([]);
    expect(state.download).not.toHaveBeenCalled();
  });

  it('surfaces managed storage failures rather than silently dropping the attachment', async () => {
    state.download.mockRejectedValue(new Error('Storage unavailable'));
    await expect(prepareCommentAttachmentEmail(input())).rejects.toThrow('Storage unavailable');
  });

  it('distinguishes active staff and clients from inactive, ambiguous or unauthorized addresses', async () => {
    expect(await classifyTicketEmailRecipient(db, 'tenant-1', 'ticket-1', addresses[0])).toBe('internal');
    state.users[0].user_type = 'service';
    expect(await classifyTicketEmailRecipient(db, 'tenant-1', 'ticket-1', addresses[0])).toBe('unknown');
    state.users[0].user_type = 'client';
    expect(await classifyTicketEmailRecipient(db, 'tenant-1', 'ticket-1', addresses[0])).toBe('external');
    state.users[0].is_inactive = true;
    expect(await classifyTicketEmailRecipient(db, 'tenant-1', 'ticket-1', addresses[0])).toBe('unknown');
    state.users[0].is_inactive = false;
    state.users.push({ user_id: 'duplicate', email: addresses[0], user_type: 'internal', is_inactive: false });
    expect(await classifyTicketEmailRecipient(db, 'tenant-1', 'ticket-1', addresses[0])).toBe('unknown');
    state.users.pop();
    state.users[0].user_type = 'internal';
    state.contacts.push({ email: addresses[0] });
    expect(await classifyTicketEmailRecipient(db, 'tenant-1', 'ticket-1', addresses[0])).toBe('unknown');
    state.contacts = [];
    state.locations.push({ email: addresses[0] });
    expect(await classifyTicketEmailRecipient(db, 'tenant-1', 'ticket-1', addresses[0])).toBe('unknown');
    state.locations = [];
    state.canAccess.mockResolvedValue(false);
    expect(await classifyTicketEmailRecipient(db, 'tenant-1', 'ticket-1', addresses[0])).toBe('unknown');
    expect(await classifyTicketEmailRecipient(db, 'tenant-1', 'ticket-1', 'unknown@example.test')).toBe('unknown');
  });

  it('preserves an authorized non-image attachment for external-only recipients without sending images', async () => {
    state.users.forEach(user => { user.user_type = 'client'; });
    state.documents.push({
      document_id: 'document-2', file_id: 'file-2', document_name: 'report.pdf',
      mime_type: 'application/pdf', file_size: 100, is_client_visible: true,
    });
    state.comment.note = JSON.stringify([
      { type: 'paragraph', content: [{ type: 'text', text: 'Keep this', styles: {} }] },
      { type: 'image', props: { url: '/api/documents/view/file-1' } },
      { type: 'file', props: { url: '/api/documents/download/document-2', name: 'report.pdf' } },
    ]);

    const result = await prepareCommentAttachmentEmail({
      ...input(), allowInlineImages: false, suppressProtectedContent: false,
    });
    expect(result.html).toContain('Keep this');
    expect(result.html).toContain('[Image non incluse]');
    expect(result.html).not.toContain('file-1');
    expect(result.attachments.map(attachment => attachment.filename)).toEqual(['report.pdf']);
    expect(state.download).toHaveBeenCalledTimes(1);
    expect(state.download).toHaveBeenCalledWith('file-2');
  });

  it('suppresses mixed-audience documents, media embeds and recipient-bound links', async () => {
    state.documents.push({
      document_id: 'document-2', file_id: 'file-2', document_name: 'report.pdf',
      mime_type: 'application/pdf', file_size: 100, is_client_visible: true,
    });
    state.comment.note = JSON.stringify([
      { type: 'paragraph', content: [{ type: 'text', text: 'Public details', styles: {} }] },
      { type: 'image', props: { url: '/api/documents/view/file-1' } },
      { type: 'file', props: { url: '/api/documents/download/document-2', name: 'report.pdf' } },
    ]);
    const result = await prepareCommentAttachmentEmail({
      ...input(), allowInlineImages: false, suppressProtectedContent: true, supportsAttachments: false,
    });

    expect(result.html).toContain('Public details');
    expect(result.html).toContain('[Image non incluse]');
    expect(result.html).toContain('[Contenu protege non inclus]');
    expect(result.html).not.toMatch(/file-1|document-2|\/api\/documents|token=/);
    expect(result.text).not.toMatch(/file-1|document-2|\/api\/documents|token=/);
    expect(result.attachments).toEqual([]);
    expect(result.downloadLinks).toEqual([]);
    expect(state.authorize).not.toHaveBeenCalled();
    expect(state.download).not.toHaveBeenCalled();
  });

  it('does not expose images with missing MIME metadata or an unclassified binary file', async () => {
    state.documents[0].mime_type = '';
    state.documents.push({
      document_id: 'document-2', file_id: 'file-2', document_name: 'unknown.bin',
      mime_type: 'application/octet-stream', file_size: 100, is_client_visible: true,
    });
    state.comment.note = JSON.stringify([
      { type: 'file', props: { url: '/api/documents/download/document-1', name: 'picture.png' } },
      { type: 'file', props: { url: '/api/documents/download/file-2', name: 'unknown.bin' } },
    ]);
    const result = await prepareCommentAttachmentEmail({
      ...input(), allowInlineImages: false, suppressProtectedContent: false, supportsAttachments: false,
    });

    expect(result.html).toContain('[Image non incluse]');
    expect(result.html).toContain('[Contenu protege non inclus]');
    expect(result.html).not.toMatch(/document-1|file-2|token=/);
    expect(result.attachments).toEqual([]);
    expect(result.downloadLinks).toEqual([]);
    expect(state.download).not.toHaveBeenCalled();
    expect(state.authorize).not.toHaveBeenCalled();
  });
});
