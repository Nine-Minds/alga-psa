import { beforeEach, describe, expect, it, vi } from 'vitest';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';

interface TestUser {
  user_id: string;
  email: string;
  user_type: 'internal' | 'client';
  is_inactive: boolean;
}

interface TestDocument {
  document_id: string;
  file_id: string;
  document_name: string;
  mime_type: string;
  file_size: number;
  is_client_visible: boolean;
}

const state = vi.hoisted(() => ({
  users: [] as TestUser[],
  documents: [] as TestDocument[],
  note: '',
  deniedRecipients: [] as string[],
  sendEmail: vi.fn(),
  download: vi.fn(),
  claim: vi.fn(),
  finish: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  runWithTenant: (_tenant: string, callback: () => unknown) => callback(),
  withTransaction: (db: unknown, callback: (trx: unknown) => unknown) => callback(db),
  tenantDb: () => ({
    tenantJoin: () => undefined,
    table: (table: string) => {
      let conditions: Record<string, unknown> = {};
      let email: string | undefined;
      let first = false;
      const allRows = (): Record<string, unknown>[] => {
        if (table === 'tenant_email_templates') return [{
          id: 'template-1', name: 'ticket-comment-added', language_code: 'en',
          html_content: '<img data-alga-brand-logo src="cid:alga-brand-logo">' +
            '{{{comment.html}}}|{{comment.rawContent}}', subject: 'Ticket update',
        }];
        if (table === 'tickets') return [{ ticket_id: 'ticket-1', client_id: 'client-1', board_id: 'board-1' }];
        if (table === 'comments') return [{
          ticket_id: 'ticket-1', comment_id: 'comment-1', thread_id: 'thread-1',
          note: state.note, publish_state: 'published', deleted_at: null,
        }];
        if (table === 'comment_threads') return [{ thread_id: 'thread-1', ticket_id: 'ticket-1' }];
        if (table === 'ticket_comment_attachments') return state.documents.map(document => ({
          ticket_id: 'ticket-1', comment_id: 'comment-1', document_id: document.document_id, state: 'attached',
        }));
        if (table === 'documents') return state.documents.map(document => ({ ...document }));
        if (table === 'users') return state.users.map(user => ({ ...user }));
        if (table === 'contacts' || table === 'client_locations') return [];
        throw new Error(`Unexpected table: ${table}`);
      };
      const rows = () => allRows().filter(row =>
        Object.entries(conditions).every(([key, value]) => row[key] === value) &&
        (!email || row.email === email));
      const chain = {
        where: (value: Record<string, unknown>) => { conditions = { ...conditions, ...value }; return chain; },
        whereRaw: (_sql: string, bindings: string[]) => { email = bindings[0]; return chain; },
        whereNull: () => chain,
        first: () => { first = true; return chain; },
        toSQL: () => ({ sql: '', bindings: [] }),
        then: (resolve: (value: unknown) => unknown) => resolve(first ? rows()[0] : rows()),
      };
      return chain;
    },
  }),
}));

vi.mock('../../../lib/db/db', () => ({
  getConnection: async () => ({ client: { config: { connection: { database: 'test' } } } }),
}));
vi.mock('@alga-psa/documents/actions/documentActions', () => ({
  authorizeAndRedactDocuments: async (_db: unknown, _tenant: string, principal: TestUser, documents: TestDocument[]) =>
    state.deniedRecipients.includes(principal.email) ? [] : documents,
}));
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: async () => true }));
vi.mock('@alga-psa/storage/StorageService', () => ({ StorageService: { downloadFile: state.download } }));
vi.mock('@shared/lib/ticketCommentAttachments', () => ({
  listPublishedCommentAttachments: async () => state.documents,
  canAccessAttachmentTicket: async () => true,
  isPublicAttachmentComment: async () => true,
}));
vi.mock('@shared/lib/deliveryLedger', () => ({
  COMMENT_EMAIL_LEDGER: { table: 'ticket_comment_email_deliveries', keyColumns: ['comment_id', 'recipient'] },
  claimDelivery: state.claim,
  finishDelivery: state.finish,
}));
vi.mock('@alga-psa/email', () => ({
  TenantEmailService: {
    getInstance: () => ({
      sendEmail: state.sendEmail,
      getAttachmentCapabilities: async () => ({ supportsAttachments: true, maxAttachmentSize: 3_000_000 }),
    }),
  },
  StaticTemplateProcessor: class {
    constructor(public subject: string, public html: string, public text: string) {}
  },
}));
vi.mock('@alga-psa/ui/lib/i18n/serverOnly', () => ({
  getServerTranslation: async () => ({
    t: (_key: string, options: { defaultValue: string }) => options.defaultValue,
  }),
}));

import { sendEventEmail, type SendEmailParams } from '../../../lib/notifications/sendEventEmail';

const params = (): SendEmailParams => ({
  mailClass: 'ticket', tenantId: 'tenant-1', entityType: 'ticket', entityId: 'ticket-1',
  to: 'to@example.test', cc: [{ email: 'cc@example.test' }], bcc: [{ email: 'bcc@example.test' }],
  subject: 'Ticket update', template: 'ticket-comment-added', locale: 'en',
  context: { ticket: { id: 'T-1' }, comment: { html: 'old content', rawContent: 'old raw content' } },
  replyContext: { ticketId: 'ticket-1', commentId: 'comment-1', issueReplyToken: false },
});

beforeEach(() => {
  state.users = ['to', 'cc', 'bcc'].map(name => ({
    user_id: name, email: `${name}@example.test`, user_type: 'internal', is_inactive: false,
  }));
  state.documents = [
    { document_id: 'image-doc', file_id: 'image-file', document_name: 'picture.png',
      mime_type: 'image/png', file_size: 10, is_client_visible: true },
    { document_id: 'pdf-doc', file_id: 'pdf-file', document_name: 'report.pdf',
      mime_type: 'application/pdf', file_size: 10, is_client_visible: true },
  ];
  state.note = JSON.stringify([
    { type: 'paragraph', content: [
      { type: 'text', text: 'Public details ', styles: {} },
      { type: 'link', href: 'https://example.test/help', content: [{ type: 'text', text: 'Help', styles: {} }] },
    ] },
    { type: 'image', props: { url: '/api/documents/view/image-file' } },
    { type: 'file', props: { url: '/api/documents/download/pdf-file', name: 'report.pdf' } },
  ]);
  state.deniedRecipients = [];
  state.sendEmail.mockReset().mockResolvedValue({ success: true });
  state.download.mockReset().mockImplementation(async (fileId: string) => ({ buffer: Buffer.from(fileId) }));
  state.claim.mockReset().mockResolvedValue(true);
  state.finish.mockReset().mockResolvedValue(undefined);
});

describe('ticket email audience policy across delivery components', () => {
  it.each([
    '/api/documents/view/image-file',
    '/api/client-portal/%64ocuments/image-doc/file',
  ])('sends an authorized internal image from %s with a non-image attachment', async imageUrl => {
    state.note = state.note.replace('/api/documents/view/image-file', imageUrl);
    await sendEventEmail(params());
    const sent = state.sendEmail.mock.calls[0][0];
    expect(sent.templateProcessor.html).toContain('Public details');
    expect(sent.templateProcessor.html).toContain('src="cid:comment-comment-1-image-doc@alga-psa"');
    expect(sent.attachments.map((attachment: { filename: string }) => attachment.filename))
      .toEqual(['picture.png', 'report.pdf']);
    expect(state.download).toHaveBeenCalledTimes(2);

    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const message = await transport.sendMail({
      from: 'sender@example.test', to: 'to@example.test',
      html: sent.templateProcessor.html, text: sent.templateProcessor.text, attachments: sent.attachments,
    });
    const parsed = await simpleParser(message.message, { skipImageLinks: true });
    const embedded = parsed.attachments.find(attachment => attachment.filename === 'picture.png');
    expect(embedded?.contentType).toBe('image/png');
    expect(embedded?.cid).toBe('comment-comment-1-image-doc@alga-psa');
    expect(embedded?.content.toString()).toBe('image-file');
    expect(parsed.html).toContain('src="cid:comment-comment-1-image-doc@alga-psa"');
  });

  it('redacts image and PDF bytes from a shared internal/external message, including Bcc', async () => {
    state.users[2].user_type = 'client';
    await sendEventEmail(params());
    const sent = state.sendEmail.mock.calls[0][0];
    expect(sent.templateProcessor.html).toContain('Public details');
    expect(sent.templateProcessor.html).toContain('href="https://example.test/help"');
    expect(sent.templateProcessor.html).toContain('[Image not included]');
    expect(sent.templateProcessor.html).toContain('[Protected content not included]');
    expect(sent.templateProcessor.html).not.toMatch(/image-file|pdf-file|old raw content/);
    expect(sent.templateProcessor.text).not.toMatch(/image-file|pdf-file|old raw content/);
    expect(sent.attachments).toEqual([]);
    expect(sent.bcc).toEqual([{ email: 'bcc@example.test' }]);
    expect(state.download).not.toHaveBeenCalled();
  });

  it('keeps an authorized non-image document for an external-only recipient', async () => {
    state.users[0].user_type = 'client';
    await sendEventEmail({ ...params(), cc: [], bcc: [] });
    const sent = state.sendEmail.mock.calls[0][0];
    expect(sent.templateProcessor.html).toContain('[Image not included]');
    expect(sent.attachments.map((attachment: { filename: string }) => attachment.filename)).toEqual(['report.pdf']);
    expect(state.download).toHaveBeenCalledOnce();
    expect(state.download).toHaveBeenCalledWith('pdf-file');
  });

  it('does not send an internal image if any staff recipient loses document access', async () => {
    state.deniedRecipients = ['bcc@example.test'];
    await sendEventEmail(params());
    const sent = state.sendEmail.mock.calls[0][0];
    expect(sent.templateProcessor.html).toContain('[Image not included]');
    expect(sent.templateProcessor.html).toContain('[Protected content not included]');
    expect(sent.templateProcessor.html).not.toContain('image-file');
    expect(sent.attachments).toEqual([]);
    expect(state.download).not.toHaveBeenCalled();
  });

  it('reconstructs a retry after a staff Bcc recipient becomes external', async () => {
    state.sendEmail.mockResolvedValueOnce({
      success: false, error: 'temporary failure', providerId: 'smtp', providerType: 'smtp',
      metadata: { retryable: true, definitelyNotSent: true },
    }).mockResolvedValueOnce({ success: true });
    const message = params();
    await expect(sendEventEmail(message)).rejects.toMatchObject({ isRetryable: true });
    state.users[2].user_type = 'client';
    await sendEventEmail(message);

    const retry = state.sendEmail.mock.calls[1][0];
    expect(retry.templateProcessor.html).toContain('[Image not included]');
    expect(retry.templateProcessor.html).toContain('[Protected content not included]');
    expect(retry.templateProcessor.html).not.toMatch(/image-file|pdf-file/);
    expect(retry.attachments).toEqual([]);
    expect(state.download).toHaveBeenCalledTimes(2);
  });
});
