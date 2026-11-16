import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendEmail = vi.fn();
let tenantRow: Record<string, unknown> | undefined;
let systemRow: Record<string, unknown> | undefined;

vi.mock('@alga-psa/db', () => {
  const makeChain = (table: string) => {
    const chain: any = new Proxy(function () {}, {
      get(_target, prop) {
        if (prop === 'then') {
          const row = table === 'tenant_email_templates' ? tenantRow : table === 'system_email_templates' ? systemRow : undefined;
          return (resolve: (v: unknown) => unknown) => resolve(row);
        }
        if (prop === 'toSQL') return () => ({ sql: '', bindings: [] });
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

import { sendEventEmail, resolveThreadSubjectTitle } from '../../../lib/notifications/sendEventEmail';

const EVENT_SUBJECTS: Array<[string, string]> = [
  ['ticket-created', 'Your Ticket Has Been Created • {{ticket.title}}'],
  ['ticket-updated', 'Ticket Updated: {{ticket.title}}'],
  ['ticket-comment-added', 'New Comment on Ticket: {{ticket.title}}'],
  ['ticket-assigned', 'Ticket Assigned: {{ticket.title}}'],
  ['ticket-closed', 'Ticket Closed: {{ticket.title}}'],
];

const send = (template: string, subject = 'hardcoded default', ticket: Record<string, unknown> = { id: '1042', ticket_number: '1042', title: 'Printer down' }) =>
  sendEventEmail({
    mailClass: 'ticket' as const,
    tenantId: '11111111-1111-1111-1111-111111111111',
    to: 'client@example.test',
    subject,
    template,
    context: { ticket },
    locale: 'en' as const,
    replyContext: { ticketId: 'ticket-uuid', threadId: 'thread-1' },
  });

describe('sendEventEmail uniform customer-facing ticket subject', () => {
  beforeEach(() => {
    sendEmail.mockReset();
    sendEmail.mockResolvedValue({ success: true, messageId: 'm1', rfcMessageId: '<m1@msp.test>' });
    tenantRow = undefined;
    systemRow = undefined;
  });

  it('gives all five event types the identical subject', async () => {
    const subjects: string[] = [];
    for (const [template, subject] of EVENT_SUBJECTS) {
      systemRow = { id: 's', name: template, html_content: '<p>x</p>', subject };
      await send(template);
      subjects.push(sendEmail.mock.calls.at(-1)![0].templateProcessor.subject);
    }
    expect(new Set(subjects).size).toBe(1);
    expect(subjects[0]).toBe('[Ticket #1042] Printer down');
  });

  it('falls back to the hardcoded params.subject when the template has none, still uniform', async () => {
    systemRow = { id: 's', name: 'ticket-closed', html_content: '<p>x</p>', subject: '' };
    await send('ticket-closed', 'Ticket Closed: Printer down');
    expect(sendEmail.mock.calls[0][0].templateProcessor.subject).toBe('[Ticket #1042] Printer down');
  });

  it('supersedes a tenant-customised subject so every event still threads as one conversation', async () => {
    tenantRow = { id: 't', name: 'ticket-updated', html_content: '<p>x</p>', subject: 'Acme update: {{ticket.title}}' };
    await send('ticket-updated');
    expect(sendEmail.mock.calls[0][0].templateProcessor.subject).toBe('[Ticket #1042] Printer down');
  });

  it('treats a tenant row with an empty subject as a default subject', async () => {
    tenantRow = { id: 't', name: 'ticket-updated', html_content: '<p>x</p>', subject: '' };
    await send('ticket-updated', 'Ticket Updated: Printer down');
    expect(sendEmail.mock.calls[0][0].templateProcessor.subject).toBe('[Ticket #1042] Printer down');
  });

  it('treats a tenant row whose subject equals the system subject (body-only edit) as default', async () => {
    systemRow = { id: 's', name: 'ticket-updated', html_content: '<p>x</p>', subject: 'Ticket Updated: {{ticket.title}}' };
    tenantRow = { id: 't', name: 'ticket-updated', html_content: '<p>edited</p>', subject: '  Ticket Updated:   {{ticket.title}} ', system_template_id: 's' };
    await send('ticket-updated');
    expect(sendEmail.mock.calls[0][0].templateProcessor.subject).toBe('[Ticket #1042] Printer down');
  });

  it('falls back to tag-only (today\'s behaviour) for non-co-managed mail with a blank title', async () => {
    systemRow = { id: 's', name: 'ticket-updated', html_content: '<p>x</p>', subject: 'Ticket Updated: {{ticket.title}}' };
    await send('ticket-updated', 'x', { id: '1042', ticket_number: '1042', title: '   ' });
    expect(sendEmail.mock.calls[0][0].templateProcessor.subject).toBe('[Ticket #1042] Ticket Updated:');
  });
});

describe('resolveThreadSubjectTitle', () => {
  const fakeKnex = { raw: (sql: string, bindings?: unknown[]) => ({ sql, bindings }) };

  const makeDb = (
    row: Record<string, unknown> | undefined,
    updates: Array<Record<string, unknown>>,
    fail = false,
  ) => {
    const chain: any = {
      where: () => chain,
      whereRaw: () => chain,
      first: async () => {
        if (fail) throw new Error('db down');
        return row;
      },
      update: async (payload: Record<string, unknown>) => {
        updates.push(payload);
        return 1;
      },
    };
    return { table: () => chain } as any;
  };

  it('pins the current title on the first customer-facing send', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const title = await resolveThreadSubjectTitle(makeDb({ email_metadata: null }, updates), fakeKnex, 'ticket-uuid', 'Printer down');
    expect(title).toBe('Printer down');
    expect(updates).toHaveLength(1);
    expect(String((updates[0].email_metadata as { sql: string }).sql)).toContain('threadSubjectTitle');
  });

  it('reuses the pinned title after the ticket is renamed', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const title = await resolveThreadSubjectTitle(
      makeDb({ email_metadata: { threadSubjectTitle: 'Printer down' } }, updates),
      fakeKnex,
      'ticket-uuid',
      'Printer down (urgent, floor 3)',
    );
    expect(title).toBe('Printer down');
    expect(updates).toHaveLength(0);
  });

  it('treats a blank pinned title as unpinned', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const title = await resolveThreadSubjectTitle(
      makeDb({ email_metadata: { threadSubjectTitle: '   ' } }, updates),
      fakeKnex,
      'ticket-uuid',
      'Printer down',
    );
    expect(title).toBe('Printer down');
    expect(updates).toHaveLength(1);
  });

  it('falls back to the current title when the lookup fails, and never throws', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const title = await resolveThreadSubjectTitle(makeDb(undefined, updates, true), fakeKnex, 'ticket-uuid', 'Printer down');
    expect(title).toBe('Printer down');
    expect(updates).toHaveLength(0);
  });
});
