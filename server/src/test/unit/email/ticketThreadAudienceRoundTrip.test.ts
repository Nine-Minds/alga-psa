import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailMessage, EmailProviderCapabilities, EmailSendResult, IEmailProvider } from '@alga-psa/types';

type Row = Record<string, any>;

// TIC001176 reproduction: the real BaseEmailService.sendEmail runs against a stateful
// in-memory db so email_sending_logs rows are produced by the production code path.
const db = vi.hoisted(() => ({
  tickets: [] as Row[],
  users: [] as Row[],
  comments: [] as Row[],
  comment_threads: [] as Row[],
  email_sending_logs: [] as Row[],
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/db', () => {
  function makeBuilder(table: keyof typeof db) {
    let rows = db[table];
    const builder: any = {
      select: () => builder,
      where: (criteria: Row) => {
        rows = rows.filter((row) =>
          Object.entries(criteria).every(([key, value]) => key === 'tenant' || row[key] === value)
        );
        return builder;
      },
      whereIn: (column: string, values: unknown[]) => {
        rows = rows.filter((row) => values.includes(row[column]));
        return builder;
      },
      whereRaw: (_sql: string, [values]: [string[]]) => {
        rows = rows.filter((row) => values.includes(String(row.email).toLowerCase()));
        return builder;
      },
      whereNotNull: () => builder,
      orderBy: () => builder,
      first: async () => rows[0],
      insert: async (row: Row) => {
        db[table].push(row);
        return [1];
      },
      update: async () => 1,
      then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject),
    };
    return builder;
  }
  return {
    createTenantKnex: vi.fn(async () => ({ knex: { raw: vi.fn() } })),
    tenantDb: () => ({ table: (table: string) => makeBuilder(table as keyof typeof db) }),
  };
});

import { BaseEmailService } from '@alga-psa/email/BaseEmailService';

const TENANT = 'tenant-1';
const TICKET = 'ticket-1';
const ROOT = '<customer-original@customer.example>';

const capabilities: EmailProviderCapabilities = {
  supportsHtml: true,
  supportsAttachments: false,
  supportsTemplating: false,
  supportsBulkSending: false,
  supportsTracking: false,
  supportsCustomDomains: false,
};

const sent: EmailMessage[] = [];
const provider: IEmailProvider = {
  providerId: 'p1',
  providerType: 'test',
  capabilities,
  async initialize() {},
  async sendEmail(message: EmailMessage): Promise<EmailSendResult> {
    sent.push(message);
    return { success: true, messageId: `prov-${sent.length}`, providerId: 'p1', providerType: 'test', sentAt: new Date() };
  },
  async healthCheck() {
    return { healthy: true };
  },
} as IEmailProvider;

class TestEmailService extends BaseEmailService {
  constructor() {
    super();
    this.emailProvider = provider;
    this.initialized = true;
  }
  protected getServiceName() {
    return 'AudienceRoundTrip';
  }
  protected async getEmailProvider() {
    return this.emailProvider;
  }
  protected getFromAddress() {
    return 'support@msp.example';
  }
}

// Mirrors appendOutboundMessageIdReference: every send is appended to the ticket chain.
function appendReference(message: EmailMessage) {
  const id = message.headers?.['Message-ID'];
  const meta = db.tickets[0].email_metadata;
  meta.references = [...(meta.references ?? []), id];
  return id as string;
}

async function send(to: string, commentId: string | undefined, subject: string) {
  const service = new TestEmailService();
  const result = await service.sendEmail({
    tenantId: TENANT,
    to,
    subject,
    html: `<p>${subject}</p>`,
    mailClass: 'notification',
    replyContext: { ticketId: TICKET, commentId },
  } as any);
  expect(result.success).toBe(true);
  return appendReference(sent[sent.length - 1]);
}

describe('TIC001176: customer mail never references internal-only Message-IDs', () => {
  beforeEach(() => {
    sent.length = 0;
    db.tickets = [{ ticket_id: TICKET, email_metadata: { messageId: ROOT, references: [] } }];
    db.users = [{ email: 'agent@msp.example', user_type: 'internal' }];
    db.comments = [
      { comment_id: 'note', thread_id: 'th-note', parent_comment_id: null, is_internal: true },
      { comment_id: 'public', thread_id: 'th-public', parent_comment_id: null, is_internal: false },
    ];
    db.comment_threads = [
      { thread_id: 'th-note', is_internal: true },
      { thread_id: 'th-public', is_internal: false },
    ];
    db.email_sending_logs = [];
  });

  it('public reply to the contact omits ids of agent-only assignment and internal-note mail', async () => {
    const assignId = await send('agent@msp.example', undefined, 'Assigned');
    const noteId = await send('agent@msp.example', 'note', 'Internal note');
    // Internal-only mail still sees the whole chain.
    expect(sent[1].headers?.['In-Reply-To']).toBe(assignId);

    await send('ada@customer.example', 'public', 'Public reply');
    const contactMail = sent[2];

    const inReplyTo = contactMail.headers?.['In-Reply-To'];
    const references = contactMail.headers?.References ?? '';
    for (const internalId of [assignId, noteId]) {
      expect(inReplyTo).not.toBe(internalId);
      expect(references).not.toContain(internalId);
    }
    expect(inReplyTo).toBe(ROOT);
    expect(references).toBe(ROOT);
    // The chain on the ticket is untouched, so inbound fallback matching still works.
    expect(db.tickets[0].email_metadata.references).toEqual(expect.arrayContaining([assignId, noteId]));

    // A later agent-only mail still sees everything, including the contact copy.
    const publicId = db.tickets[0].email_metadata.references[2];
    await send('agent@msp.example', undefined, 'Customer replied');
    expect(sent[3].headers?.['In-Reply-To']).toBe(publicId);
    expect(sent[3].headers?.References).toBe([ROOT, assignId, noteId, publicId].join(' '));

    // And a second contact mail references the earlier public one but still no internal ids.
    await send('ada@customer.example', 'public', 'Public follow-up');
    expect(sent[4].headers?.['In-Reply-To']).toBe(publicId);
    expect(sent[4].headers?.References).toBe(`${ROOT} ${publicId}`);
  });
});
