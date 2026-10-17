import { beforeEach, describe, expect, it, vi } from 'vitest';

const inserts: string[] = [];
const sendEmail = vi.fn();

vi.mock('@alga-psa/db', () => {
  const makeChain = (table: string) => {
    const chain: any = new Proxy(function () {}, {
      get(_target, prop) {
        if (prop === 'then') {
          const rows: Record<string, unknown> = {
            tenant_email_templates: {
              id: 't1',
              name: 'ticket-board-created',
              html_content: '<p>Ticket body</p>',
              subject: 'New Ticket on Board',
            },
          };
          return (resolve: (v: unknown) => unknown) => resolve(rows[table]);
        }
        if (prop === 'toSQL') return () => ({ sql: '', bindings: [] });
        if (prop === 'insert') {
          return () => {
            inserts.push(table);
            return chain;
          };
        }
        return () => chain;
      },
    });
    return chain;
  };
  return { tenantDb: () => ({ table: (name: string) => makeChain(name) }) };
});

vi.mock('../../../lib/db/db', () => ({
  getConnection: async () => ({
    client: { config: { connection: { database: 'test' } } },
    schema: { hasTable: async () => true },
    raw: () => 'raw',
  }),
}));

vi.mock('@alga-psa/email', () => ({
  TenantEmailService: { getInstance: () => ({ sendEmail }) },
  StaticTemplateProcessor: class {
    constructor(public subject: string, public html: string, public text: string) {}
  },
}));

vi.mock('@alga-psa/notifications/notifications/emailLocaleResolver', () => ({
  getUserInfoForEmail: async () => null,
  resolveEmailLocale: async () => 'en',
}));

import { sendEventEmail } from '../../../lib/notifications/sendEventEmail';

const baseParams = {
  mailClass: 'ticket' as const,
  tenantId: '11111111-1111-1111-1111-111111111111',
  to: 'queue-dl@msp.test',
  subject: 'New Ticket on Board',
  template: 'ticket-board-created',
  context: { ticket: { id: 'T-42', title: 'Printer down' } },
  locale: 'en' as const,
};

const replyContext = { ticketId: 'ticket-1', threadId: 'thread-1' };

describe('sendEventEmail replyContext.issueReplyToken', () => {
  beforeEach(() => {
    inserts.length = 0;
    sendEmail.mockReset();
    sendEmail.mockResolvedValue({ success: true, messageId: 'm1', rfcMessageId: '<m1@msp.test>' });
  });

  it('mints a token, adds markers and persists it by default', async () => {
    await sendEventEmail({ ...baseParams, replyContext });

    const sent = sendEmail.mock.calls[0][0];
    const token = sent.replyContext.conversationToken;
    expect(token).toEqual(expect.any(String));
    expect(sent.templateProcessor.html).toContain(`ALGA-REPLY-TOKEN ${token}`);
    expect(sent.templateProcessor.text).toContain('Please reply above this line');
    expect(inserts).toContain('email_reply_tokens');
  });

  it('behaves the same when issueReplyToken is explicitly true', async () => {
    await sendEventEmail({ ...baseParams, replyContext: { ...replyContext, issueReplyToken: true } });

    const sent = sendEmail.mock.calls[0][0];
    expect(sent.replyContext.conversationToken).toEqual(expect.any(String));
    expect(sent.templateProcessor.html).toContain('ALGA-REPLY-TOKEN');
    expect(inserts).toContain('email_reply_tokens');
  });

  it('mints no token, adds no markers and persists nothing when false, but keeps thread context and subject', async () => {
    await sendEventEmail({ ...baseParams, replyContext: { ...replyContext, issueReplyToken: false } });

    const sent = sendEmail.mock.calls[0][0];
    expect(sent.replyContext.conversationToken).toBeUndefined();
    expect(sent.replyContext).toEqual({ ticketId: 'ticket-1', threadId: 'thread-1' });
    expect(sent.templateProcessor.html).not.toContain('ALGA-REPLY-TOKEN');
    expect(sent.templateProcessor.html).not.toContain('data-alga-reply-token');
    expect(sent.templateProcessor.html).not.toContain('Please reply above this line');
    expect(sent.templateProcessor.text).not.toContain('ALGA-REPLY-TOKEN');
    expect(sent.templateProcessor.text).not.toContain('ALGA-TICKET-ID');
    expect(inserts).not.toContain('email_reply_tokens');
    // The [Ticket #N] subject token stays.
    expect(sent.templateProcessor.subject).toContain('T-42');
    // Thread headers are applied downstream from replyContext.ticketId, which is preserved.
    expect(sent.replyContext.ticketId).toBe('ticket-1');
  });
});
