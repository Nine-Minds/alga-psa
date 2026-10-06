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
    /** Entries for tickets.attributes.watch_list. */
    watchers?: string[];
    /** Email of an internal user to assign the ticket to. */
    assignedEmail?: string;
    /** Original inbound Message-ID, so the send carries thread headers. */
    inboundMessageId?: string;
    /** Author-less comment, as a workflow's tickets.add_comment writes it. */
    systemAuthored?: boolean;
    suppressContactNotifications?: boolean;
    threadedReply?: boolean;
  }) {
    const ticket = randomUUID(), comment = randomUUID(), thread = randomUUID();
    let contact: string | null = null;
    if (options.requesterEmail) {
      contact = randomUUID();
      await table('contacts').insert({ tenant, contact_name_id: contact, client_id: client, full_name: 'Requester', email: options.requesterEmail });
    }
    let assignedTo: string | null = null;
    if (options.assignedEmail) {
      assignedTo = randomUUID();
      await table('users').insert({ tenant, user_id: assignedTo, username: assignedTo, email: options.assignedEmail, hashed_password: 'unused', user_type: 'internal', is_inactive: false, first_name: 'Assigned', last_name: 'Agent' });
    }
    await table('tickets').insert({
      tenant, ticket_id: ticket, ticket_number: `CCBCC-${ticket.slice(0, 8)}`, client_id: client,
      contact_name_id: contact, title: 'Cc/Bcc delivery', entered_by: agent, assigned_to: assignedTo,
      ...(options.watchers?.length
        ? { attributes: JSON.stringify({ watch_list: options.watchers.map(email => ({ email, active: true })) }) }
        : {}),
      ...(options.inboundMessageId
        ? { email_metadata: JSON.stringify({ messageId: options.inboundMessageId, threadId: `thread-${ticket.slice(0, 8)}`, references: [] }) }
        : {}),
    });
    await table('comment_threads').insert({ tenant, thread_id: thread, ticket_id: ticket, root_comment_id: comment, is_internal: Boolean(options.isInternal), created_by: agent });
    const note = JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Copy of the reply for the one-off recipients.', styles: {} }] }]);
    let parentCommentId: string | null = null;
    if (options.threadedReply) {
      parentCommentId = randomUUID();
      await table('comments').insert({
        tenant, comment_id: parentCommentId, thread_id: thread, ticket_id: ticket, user_id: agent, author_type: 'internal',
        note, is_internal: false, is_resolution: false, metadata: JSON.stringify({ closes_ticket: false }),
      });
    }
    await table('comments').insert({
      tenant, comment_id: comment, thread_id: thread, ticket_id: ticket,
      // A workflow comment stores author_type 'internal' with no user row.
      user_id: options.systemAuthored ? null : agent, author_type: 'internal',
      parent_comment_id: parentCommentId,
      note, is_internal: Boolean(options.isInternal), is_resolution: false,
      metadata: JSON.stringify({ closes_ticket: false, ...(options.recipients ? { email_recipients: options.recipients } : {}) }),
    });
    const event = {
      id: randomUUID(),
      eventType: 'TICKET_COMMENT_ADDED',
      payload: {
        tenantId: tenant, ticketId: ticket, actorUserId: options.systemAuthored ? undefined : agent,
        ...(options.suppressContactNotifications ? { suppressContactNotifications: true } : {}),
        comment: { id: comment, content: note, author: 'Agent Smith', isInternal: Boolean(options.isInternal) },
      },
    };
    return { ticket, comment, thread, event };
  }

  // A second public comment on an existing ticket+thread, carrying no one-off
  // recipients — used to prove the Cc list does not stick to the ticket.
  async function followUpComment(ticket: string, thread: string) {
    const comment = randomUUID();
    const note = JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'A later reply nobody was copied on.', styles: {} }] }]);
    await table('comments').insert({
      tenant, comment_id: comment, thread_id: thread, ticket_id: ticket, user_id: agent, author_type: 'internal',
      note, is_internal: false, is_resolution: false, metadata: JSON.stringify({ closes_ticket: false }),
    });
    return {
      id: randomUUID(),
      eventType: 'TICKET_COMMENT_ADDED',
      payload: {
        tenantId: tenant, ticketId: ticket, actorUserId: agent,
        comment: { id: comment, content: note, author: 'Agent Smith', isInternal: false },
      },
    };
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

  it('T028: a watcher who is also cc\'d receives exactly one message — the combined one', async () => {
    const requester = address('requester'), watcher = address('watcher');
    const { event } = await commentFixture({
      requesterEmail: requester,
      watchers: [watcher],
      recipients: { cc: [{ email: watcher }] },
    });

    await deliver(event);

    const [requesterMail] = await inbox(requester);
    expect(addressText(requesterMail.cc)).toContain(watcher);
    const watcherCopies = await inbox(watcher);
    expect(watcherCopies).toHaveLength(1);
    // Same Message-ID as the requester's: the separate watcher send was skipped.
    expect(watcherCopies[0].messageId).toBe(requesterMail.messageId);
  }, 60_000);

  it('T029: the assigned agent who is also bcc\'d receives exactly one message', async () => {
    const requester = address('requester'), assignee = address('assignee');
    const { event } = await commentFixture({
      requesterEmail: requester,
      assignedEmail: assignee,
      recipients: { bcc: [{ email: assignee }] },
    });

    await deliver(event);

    const [requesterMail] = await inbox(requester);
    expect(requesterMail).toBeDefined();
    const assigneeCopies = await inbox(assignee);
    expect(assigneeCopies).toHaveLength(1);
    expect(assigneeCopies[0].messageId).toBe(requesterMail.messageId);
    expect(assigneeCopies[0].headerLines.some(line => line.key === 'bcc')).toBe(false);
  }, 60_000);

  it('T030: the requester\'s own address in cc is dropped instead of duplicated', async () => {
    const requester = address('requester'), cc = address('cc');
    const { event } = await commentFixture({
      requesterEmail: requester,
      recipients: { cc: [{ email: requester.toUpperCase() }, { email: cc }] },
    });

    await deliver(event);

    const requesterCopies = await inbox(requester);
    expect(requesterCopies).toHaveLength(1);
    expect(addressText(requesterCopies[0].cc)).toContain(cc);
    expect(addressText(requesterCopies[0].cc)?.toLowerCase()).not.toContain(requester);

    const log = await table('email_sending_logs').where({ tenant }).first();
    expect(addressList(log.cc_addresses)).toEqual([cc]);
  }, 60_000);

  it('T025: a suppressed requester notification still delivers the chosen Cc', async () => {
    const requester = address('requester'), cc = address('cc');
    const { event } = await commentFixture({
      requesterEmail: requester,
      suppressContactNotifications: true,
      recipients: { cc: [{ email: cc }] },
    });

    await deliver(event);

    expect(await inbox(requester)).toHaveLength(0);
    const [combined] = await inbox(cc);
    expect(combined).toBeDefined();
    expect(addressText(combined.to)).toBe(cc);
  }, 60_000);

  it('T027: a tenant that switched comment notifications off mails nobody, Cc included', async () => {
    const requester = address('requester'), cc = address('cc'), bcc = address('bcc');
    // The tenant-wide kill switch wins over an explicit Cc: when the requester
    // is not emailed because notifications are off, the copies are off too.
    await table('notification_settings').insert({ tenant, is_enabled: false });
    const { event } = await commentFixture({
      requesterEmail: requester,
      recipients: { cc: [{ email: cc }], bcc: [{ email: bcc }] },
    });

    await deliver(event);

    for (const recipient of [requester, cc, bcc]) {
      expect(await inbox(recipient)).toHaveLength(0);
    }
    expect(await table('email_sending_logs').where({ tenant })).toHaveLength(0);
  }, 60_000);

  it('T034: the combined message and the Cc fallback both carry the thread headers', async () => {
    const inboundMessageId = `<original-${randomUUID()}@example.test>`;
    const requester = address('requester'), cc = address('cc');
    const { event } = await commentFixture({
      requesterEmail: requester,
      inboundMessageId,
      recipients: { cc: [{ email: cc }] },
    });

    await deliver(event);

    const [requesterMail] = await inbox(requester);
    expect(requesterMail.inReplyTo).toBe(inboundMessageId);
    expect(requesterMail.references).toContain(inboundMessageId);

    // Same ticket thread, no requester this time: the fallback message must be
    // threaded too, or the copies start a new conversation in the recipient's
    // mail client. Both the subscriber's headers and the ticket-scoped headers
    // the email service applies have to survive the fallback shape.
    const fallbackCc = address('fallback-cc');
    const fallback = await commentFixture({
      inboundMessageId,
      recipients: { cc: [{ email: fallbackCc }] },
    });
    await deliver(fallback.event);

    const [combined] = await inbox(fallbackCc);
    expect(combined).toBeDefined();
    expect(combined.inReplyTo).toBe(inboundMessageId);
    expect(combined.references).toContain(inboundMessageId);
  }, 60_000);

  it('T036: a later comment without Cc does not reach the previously copied address', async () => {
    const requester = address('requester'), cc = address('cc');
    const { ticket, thread, event } = await commentFixture({
      requesterEmail: requester,
      recipients: { cc: [{ email: cc }] },
    });

    await deliver(event);
    expect(await inbox(cc)).toHaveLength(1);

    await deliver(await followUpComment(ticket, thread));

    // The requester got both comments; the one-off recipient got only the one
    // they were copied on — a Cc never joins the ticket.
    expect(await inbox(requester)).toHaveLength(2);
    expect(await inbox(cc)).toHaveLength(1);
  }, 60_000);

  it('T072: a threaded reply carrying Cc is delivered like a top-level comment', async () => {
    const requester = address('requester'), cc = address('cc');
    const { event } = await commentFixture({
      requesterEmail: requester,
      threadedReply: true,
      recipients: { cc: [{ email: cc }] },
    });

    await deliver(event);

    const [requesterMail] = await inbox(requester);
    expect(addressText(requesterMail.cc)).toContain(cc);
    const ccCopies = await inbox(cc);
    expect(ccCopies).toHaveLength(1);
    expect(ccCopies[0].messageId).toBe(requesterMail.messageId);
  }, 60_000);

  it('T044: an author-less workflow comment still reaches its Cc recipients', async () => {
    const cc = address('workflow-cc');
    // tickets.add_comment runs without an actor: the row has no user_id, so the
    // "from an agent" check cannot see a user — the stored author_type does.
    const { event } = await commentFixture({ systemAuthored: true, recipients: { cc: [{ email: cc }] } });

    await deliver(event);

    const [combined] = await inbox(cc);
    expect(combined).toBeDefined();
    expect(addressText(combined.to)).toBe(cc);
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
