import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { AsyncLocalStorage } from 'node:async_hooks';
import type { Knex } from 'knex';
import { simpleParser, type ParsedMail } from 'mailparser';
import * as dbModule from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

// The contract tests next to the subscriber only prove the code reads a certain
// way. This file proves the per-comment Cc/Bcc recipients reach the wire: a
// real migrated database, the real email service, the real SMTP provider and a
// real SMTP server, with no sender or subscriber mocks. What it asserts is the
// shape of the delivered messages — one message carrying the Cc and Bcc
// envelope recipients, Bcc never named in the headers anyone receives, and the
// two fallback shapes used when no requester mail goes out.
const tenantStore = (globalThis as {
  __ALGA_PSA_TENANT_CONTEXT__?: AsyncLocalStorage<string>;
}).__ALGA_PSA_TENANT_CONTEXT__;
const withoutAmbientTenant = <T>(fn: () => Promise<T>): Promise<T> =>
  tenantStore ? tenantStore.exit(fn) : fn();

describe('per-comment Cc/Bcc delivery over isolated SMTP', () => {
  let conn: Knex;
  let trx: Knex.Transaction;
  let tenant: string, agent: string, client: string;
  let smtpPort: number, apiPort: number;
  const table = (name: string) => dbModule.tenantDb(trx, tenant).table(name);
  const address = (label: string) => `${label}-${randomUUID()}@example.test`;
  // mailparser types every address header as one object or an array of them.
  const addressText = (field: ParsedMail['to'] | ParsedMail['cc']): string | undefined =>
    Array.isArray(field) ? field.map(entry => entry.text).join(', ') : field?.text;
  // email_sending_logs stores the address lists as jsonb, which the pg driver
  // hands back already parsed.
  const addressList = (value: unknown): string[] =>
    typeof value === 'string' ? JSON.parse(value) : (value as string[]);

  beforeAll(async () => {
    if (process.env.COMMENT_SMTP_ISOLATED !== 'true') throw new Error('COMMENT_SMTP_ISOLATED=true is required');
    smtpPort = Number(process.env.COMMENT_SMTP_PORT);
    apiPort = Number(process.env.COMMENT_SMTP_API_PORT);
    for (const port of [smtpPort, apiPort]) {
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Explicit isolated SMTP and API ports are required');
    }
    conn = await createTestDbConnection();
  }, 120_000);
  afterAll(async () => { await conn?.destroy(); });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await trx?.rollback();
  });

  beforeEach(async () => {
    trx = await conn.transaction();
    tenant = randomUUID(); agent = randomUUID(); client = randomUUID();
    await trx('tenants').insert({ tenant, client_name: 'Isolated SMTP Cc/Bcc', email: 'tenant@example.test', product_code: 'psa' });
    await table('clients').insert({ tenant, client_id: client, client_name: 'Cc/Bcc fixture' });
    await table('users').insert({ tenant, user_id: agent, username: agent, email: 'agent@example.test', hashed_password: 'unused', user_type: 'internal', is_inactive: false, first_name: 'Agent', last_name: 'Smith' });
    await table('tenant_email_templates').insert({ tenant, name: 'ticket-comment-added', language_code: 'en', subject: 'Comment on {{ticket.id}}', html_content: '<p>{{{comment.content}}}</p>', text_content: '{{comment.text}}' });
    await table('tenant_email_settings').insert({ tenant, email_provider: 'smtp', default_from_domain: 'example.test', ticketing_from_email: 'agent@example.test', provider_configs: JSON.stringify([{
      providerId: `smtp-${tenant}`, providerType: 'smtp', isEnabled: true,
      config: { host: '127.0.0.1', port: smtpPort, secure: false, rejectUnauthorized: false, from: 'agent@example.test' },
    }]) });
    vi.spyOn(dbModule, 'getConnection').mockResolvedValue(trx);
    vi.spyOn(dbModule, 'createTenantKnex').mockResolvedValue({ knex: trx, tenant } as any);
    const { getSecretProviderInstance } = await import('@alga-psa/core/secrets');
    vi.spyOn(await getSecretProviderInstance(), 'getAppSecret').mockImplementation(async name =>
      name.toLowerCase() === 'nextauth_secret' ? 'isolated-smtp-ccbcc-secret' : undefined);
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000');
  });

  async function inbox(recipient: string) {
    const response = await fetch(`http://127.0.0.1:${apiPort}/api/user/${encodeURIComponent(recipient)}/messages`);
    if (response.status === 400) return [];
    expect(response.status).toBe(200);
    const received: { mimeMessage: string }[] = await response.json();
    return Promise.all(received.map(message => simpleParser(message.mimeMessage)));
  }

  // One ticket plus one agent comment, with an optional requester contact and
  // the one-off recipients written exactly as the normalizer writes them.
  async function commentFixture(options: {
    requesterEmail?: string;
    isInternal?: boolean;
    recipients?: { cc?: { email: string; name?: string }[]; bcc?: { email: string; name?: string }[] };
  }) {
    const ticket = randomUUID(), comment = randomUUID(), thread = randomUUID();
    let contact: string | null = null;
    if (options.requesterEmail) {
      contact = randomUUID();
      await table('contacts').insert({ tenant, contact_name_id: contact, client_id: client, full_name: 'Requester', email: options.requesterEmail });
    }
    await table('tickets').insert({ tenant, ticket_id: ticket, ticket_number: `CCBCC-${ticket.slice(0, 8)}`, client_id: client, contact_name_id: contact, title: 'Cc/Bcc delivery', entered_by: agent });
    await table('comment_threads').insert({ tenant, thread_id: thread, ticket_id: ticket, root_comment_id: comment, is_internal: Boolean(options.isInternal), created_by: agent });
    const note = JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Copy of the reply for the one-off recipients.', styles: {} }] }]);
    await table('comments').insert({
      tenant, comment_id: comment, thread_id: thread, ticket_id: ticket, user_id: agent, author_type: 'internal',
      note, is_internal: Boolean(options.isInternal), is_resolution: false,
      metadata: JSON.stringify({ closes_ticket: false, ...(options.recipients ? { email_recipients: options.recipients } : {}) }),
    });
    const event = {
      id: randomUUID(),
      eventType: 'TICKET_COMMENT_ADDED',
      payload: {
        tenantId: tenant, ticketId: ticket, actorUserId: agent,
        comment: { id: comment, content: note, author: 'Agent Smith', isInternal: Boolean(options.isInternal) },
      },
    };
    return { ticket, comment, event };
  }

  async function deliver(event: unknown) {
    const { ticketEmailSubscriberTestHarness } = await import('@/lib/eventBus/subscribers/ticketEmailSubscriber');
    await withoutAmbientTenant(() => ticketEmailSubscriberTestHarness.handleTicketCommentAdded(event as never));
  }

  it('T022/T033: Cc rides on the requester message, Bcc stays out of every header, and the log keeps both lists', async () => {
    const requester = address('requester'), cc = address('cc'), bcc = address('bcc');
    const { event } = await commentFixture({
      requesterEmail: requester,
      recipients: { cc: [{ email: cc, name: 'Cc Person' }], bcc: [{ email: bcc }] },
    });

    await deliver(event);

    const [requesterMail] = await inbox(requester);
    expect(requesterMail).toBeDefined();
    expect(addressText(requesterMail.to)).toBe(requester);
    expect(addressText(requesterMail.cc)).toContain(cc);
    expect(requesterMail.headerLines.some(line => line.key === 'bcc')).toBe(false);

    // One message: the copies carry the same Message-ID, so one reply token and
    // one thread for everybody on it.
    const ccCopies = await inbox(cc);
    expect(ccCopies).toHaveLength(1);
    expect(ccCopies[0].messageId).toBe(requesterMail.messageId);
    const bccCopies = await inbox(bcc);
    expect(bccCopies).toHaveLength(1);
    expect(bccCopies[0].messageId).toBe(requesterMail.messageId);
    expect(bccCopies[0].headerLines.some(line => line.key === 'bcc')).toBe(false);

    const log = await table('email_sending_logs').where({ tenant }).first();
    expect(addressList(log.to_addresses)).toEqual([requester]);
    expect(addressList(log.cc_addresses)).toEqual([cc]);
    expect(addressList(log.bcc_addresses)).toEqual([bcc]);
  }, 60_000);

  it('T024: with no requester email the Cc list becomes one combined message', async () => {
    const firstCc = address('cc-one'), secondCc = address('cc-two'), bcc = address('bcc');
    const { event } = await commentFixture({
      recipients: { cc: [{ email: firstCc }, { email: secondCc }], bcc: [{ email: bcc }] },
    });

    await deliver(event);

    const [combined] = await inbox(firstCc);
    expect(combined).toBeDefined();
    expect(addressText(combined.to)).toBe(firstCc);
    expect(addressText(combined.cc)).toContain(secondCc);
    for (const recipient of [secondCc, bcc]) {
      const copies = await inbox(recipient);
      expect(copies).toHaveLength(1);
      expect(copies[0].messageId).toBe(combined.messageId);
    }
  }, 60_000);

  it('T026: a Bcc-only list with no requester becomes one message per address, never an empty To', async () => {
    const firstBcc = address('bcc-one'), secondBcc = address('bcc-two');
    const { event } = await commentFixture({ recipients: { bcc: [{ email: firstBcc }, { email: secondBcc }] } });

    await deliver(event);

    const seen: (string | undefined)[] = [];
    for (const recipient of [firstBcc, secondBcc]) {
      const copies = await inbox(recipient);
      expect(copies).toHaveLength(1);
      expect(addressText(copies[0].to)).toBe(recipient);
      expect(copies[0].headerLines.some(line => line.key === 'bcc')).toBe(false);
      seen.push(copies[0].messageId);
    }
    expect(new Set(seen).size).toBe(2);
  }, 60_000);

  it('T031: an internal comment carrying email_recipients sends nothing to them', async () => {
    const cc = address('internal-cc'), bcc = address('internal-bcc');
    const { event } = await commentFixture({ isInternal: true, recipients: { cc: [{ email: cc }], bcc: [{ email: bcc }] } });

    await deliver(event);

    expect(await inbox(cc)).toHaveLength(0);
    expect(await inbox(bcc)).toHaveLength(0);
  }, 60_000);

  it('T035: a comment without email_recipients is delivered exactly as before', async () => {
    const requester = address('plain-requester');
    const { event } = await commentFixture({ requesterEmail: requester });

    await deliver(event);

    const [requesterMail] = await inbox(requester);
    expect(requesterMail).toBeDefined();
    expect(requesterMail.cc).toBeUndefined();
    const log = await table('email_sending_logs').where({ tenant });
    expect(log).toHaveLength(1);
    expect(log[0].cc_addresses).toBeNull();
    expect(log[0].bcc_addresses).toBeNull();
  }, 60_000);
});
