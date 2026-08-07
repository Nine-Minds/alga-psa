import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import Knex from 'knex';
import { randomUUID, createHash } from 'crypto';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { tenantDb } from '@alga-psa/db';

const SEEDED_TENANT_DISCOVERY_REASON = 'durable inbox integration discovers seeded tenant';

const describeDb = await describeWithDb();

let db: Knex;
let tenantId: string;
let clientId: string;
let boardId: string;
let statusId: string;
let priorityId: string;
let enteredByUserId: string;

// Mock storage so staging/artifact persistence runs without a real object store.
const storageObjects = new Map<string, Buffer>();
const storageProviderMock = {
  exists: vi.fn(async (path: string) => storageObjects.has(path)),
  upload: vi.fn(async (buffer: Buffer, path: string) => {
    storageObjects.set(path, Buffer.from(buffer));
    return { path, size: buffer.length, mime_type: 'message/rfc822' };
  }),
  download: vi.fn(async (path: string) => {
    const buffer = storageObjects.get(path);
    if (!buffer) throw new Error(`object not found: ${path}`);
    return buffer;
  }),
};

vi.mock('@alga-psa/storage/StorageProviderFactory', () => ({
  StorageProviderFactory: { createProvider: vi.fn(async () => storageProviderMock) },
  generateStoragePath: (_tenant: string, basePath: string, name: string) => `${basePath}/${Date.now()}-${name}`,
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: vi.fn(async () => {
    if (!db) throw new Error('Test DB not initialized');
    return db;
  }),
  destroyAdminConnection: vi.fn(async () => {}),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: vi.fn(async () => null),
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: async () => '',
    getTenantSecret: async () => null,
  })),
}));

vi.mock('@alga-psa/shared/services/email/inboundReplyAcknowledgementDecider', () => ({
  resolveInboundReplyAcknowledgementDecider: vi.fn(async () => ({
    decide: async () => ({
      decision: 'NOT_ACK',
      source: 'default',
      attempted: false,
      reason: 'test',
      model: null,
      rawOutput: null,
      error: null,
    }),
  })),
}));

function tenantTable<Row extends object = Record<string, any>>(tableExpression: string): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(db, tenantId).table<Row>(tableExpression);
}

function sha256(input: Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

function buildMime(params: {
  from: string;
  to: string;
  subject: string;
  messageId: string;
  text: string;
  inReplyTo?: string;
  references?: string[];
}): Buffer {
  const lines: string[] = [
    `From: Sender <${params.from}>`,
    `To: Support <${params.to}>`,
    `Subject: ${params.subject}`,
    `Message-ID: <${params.messageId}>`,
  ];
  if (params.inReplyTo) lines.push(`In-Reply-To: <${params.inReplyTo}>`);
  if (params.references?.length) lines.push(`References: ${params.references.map((r) => `<${r}>`).join(' ')}`);
  lines.push(
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    params.text,
    '',
  );
  return Buffer.from(lines.join('\r\n'));
}

async function setupProvider(params: { mailbox: string; providerType?: 'google' | 'microsoft' | 'imap' }): Promise<{ providerId: string; defaultsId: string }> {
  const defaultsId = randomUUID();
  const providerId = randomUUID();
  await tenantTable('inbound_ticket_defaults').insert({
    id: defaultsId,
    tenant: tenantId,
    short_name: `durable-${defaultsId.slice(0, 6)}`,
    display_name: `Durable Defaults ${defaultsId.slice(0, 6)}`,
    description: 'Test defaults',
    board_id: boardId,
    status_id: statusId,
    priority_id: priorityId,
    client_id: clientId,
    entered_by: enteredByUserId,
    is_active: true,
    is_default: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  const providerType = params.providerType ?? 'google';
  await tenantTable('email_providers').insert({
    id: providerId,
    tenant: tenantId,
    provider_type: providerType,
    provider_name: `Durable Provider ${providerId.slice(0, 6)}`,
    mailbox: params.mailbox,
    is_active: true,
    status: 'connected',
    inbound_ticket_defaults_id: defaultsId,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  if (providerType === 'google') {
    await tenantTable('google_email_provider_config').insert({
      email_provider_id: providerId,
      tenant: tenantId,
      client_id: 'client-id',
      client_secret: 'secret',
      project_id: 'project-id',
      pubsub_topic_name: 'topic',
      pubsub_subscription_name: `sub-${providerId.slice(0, 6)}`,
      access_token: 'token',
      refresh_token: 'refresh',
      history_id: '1',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
  } else if (providerType === 'microsoft') {
    await tenantTable('microsoft_email_provider_config').insert({
      email_provider_id: providerId,
      tenant: tenantId,
      client_id: 'client-id',
      client_secret: 'secret',
      tenant_id: 'tenant-id',
      redirect_uri: 'http://localhost:3000/api/auth/callback',
      access_token: 'token',
      refresh_token: 'refresh',
      webhook_subscription_id: `sub-${providerId.slice(0, 6)}`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
  } else {
    await tenantTable('imap_email_provider_config').insert({
      email_provider_id: providerId,
      tenant: tenantId,
      host: 'localhost',
      port: 993,
      secure: true,
      auth_type: 'password',
      username: 'imap-user',
      uid_validity: '1',
      folder_state: {},
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
  }
  return { providerId, defaultsId };
}

async function stageAndUpsertInbox(params: {
  providerId: string;
  providerType: 'google' | 'microsoft' | 'imap';
  rawMime: Buffer;
  messageId: string;
}): Promise<{ inboxId: string; normalizedMessageId: string }> {
  const { stageInboundSourceMime } = await import('@alga-psa/shared/services/email/inboundEmailSourceStager');
  const { upsertInbox, upsertIngress } = await import('@alga-psa/shared/services/email/inboundEmailDurableStore');
  const { normalizeInboundMessageIdentity } = await import('@alga-psa/shared/services/email/inboundEmailIdentity');

  const identity = normalizeInboundMessageIdentity({
    providerType: params.providerType,
    rfcMessageId: params.messageId,
    providerMessageId: params.messageId,
  })!;

  const ingress = await upsertIngress(db, {
    tenant: tenantId,
    provider_id: params.providerId,
    provider_type: params.providerType,
    ingress_key: `test:${params.messageId}`,
    provider_pointer: { messageId: params.messageId },
  });

  const staged = await stageInboundSourceMime({
    tenant: tenantId,
    providerId: params.providerId,
    providerType: params.providerType,
    normalizedMessageId: identity.normalized,
    rawMime: params.rawMime,
  });

  const row = await upsertInbox(db, {
    tenant: tenantId,
    ingress_id: ingress.ingress_id,
    provider_id: params.providerId,
    provider_type: params.providerType,
    normalized_message_id: identity.normalized,
    provider_message_id: params.messageId,
    rfc_message_id: identity.rfcMessageId,
    source_object_key: staged.objectKey,
    source_sha256: staged.sha256,
    source_size_bytes: staged.sizeBytes,
    source_staged_at: new Date(),
    envelope: { messageId: params.messageId },
  });

  return { inboxId: row.inbox_id, normalizedMessageId: identity.normalized };
}

async function processInbox(inboxId: string, owner: string = `test-owner-${randomUUID()}`): Promise<ReturnType<typeof runProcessor>> {
  const { processInboundInbox } = await import('@alga-psa/shared/services/email/inboundEmailCoreProcessor');
  return runProcessor(inboxId, owner, processInboundInbox);
}

async function runProcessor(inboxId: string, owner: string, fn: any): Promise<any> {
  return fn({
    tenantId,
    inboxId,
    owner,
    leaseTtlMs: 30_000,
    mode: 'enforce',
  });
}

async function countRows(table: string, where?: Record<string, unknown>): Promise<number> {
  const query = tenantDb(db, tenantId).table(table);
  const q = where ? query.where(where) : query;
  const row = await q.count<{ count: string }[]>('* as count').first();
  return Number(row?.count ?? 0);
}

async function countTicketsByMessageId(messageId: string): Promise<number> {
  const row = await tenantDb(db, tenantId).table('tickets')
    .whereRaw("email_metadata->>'messageId' = ?", [messageId])
    .count<{ count: string }[]>('* as count')
    .first();
  return Number(row?.count ?? 0);
}

async function countCommentsByMessageId(messageId: string): Promise<number> {
  const row = await tenantDb(db, tenantId).table('comments')
    .whereRaw("metadata->'email'->>'messageId' = ?", [messageId])
    .count<{ count: string }[]>('* as count')
    .first();
  return Number(row?.count ?? 0);
}

async function deleteTicketRows(ticketId: string): Promise<void> {
  const childTables = ['email_reply_tokens', 'ticket_audit_logs', 'sla_audit_log', 'sla_notifications_sent', 'ticket_auto_close_state', 'comment_threads', 'comments'];
  for (const table of childTables) {
    await tenantDb(db, tenantId).table(table).where({ ticket_id: ticketId }).delete();
  }
  await tenantDb(db, tenantId).table('tickets').where({ ticket_id: ticketId }).delete();
}

describeDb('Inbound email durable inbox (integration)', () => {
  const cleanup: Array<() => Promise<void>> = [];
  const createdTicketIds: string[] = [];

  beforeAll(async () => {
    process.env.UNIFIED_INBOUND_EMAIL_DURABLE_MODE = 'enforce';
    db = await createTestDbConnection();

    const tenant = await tenantDb(db, SEEDED_TENANT_DISCOVERY_REASON)
      .unscoped<{ tenant: string }>('tenants', SEEDED_TENANT_DISCOVERY_REASON)
      .first('tenant');
    if (!tenant?.tenant) throw new Error('Expected seeded tenant');
    tenantId = tenant.tenant;

    const client = await tenantTable('clients').first<{ client_id: string }>('client_id');
    if (!client?.client_id) throw new Error('Expected seeded client');
    clientId = client.client_id;

    const status = await tenantTable('statuses')
      .where({ status_type: 'ticket', is_default: true })
      .whereNotNull('board_id')
      .first<{ status_id: string; board_id: string }>('status_id', 'board_id');
    if (!status?.status_id) throw new Error('Expected seeded default ticket status');
    statusId = status.status_id;
    boardId = status.board_id;

    const priority = await tenantTable('priorities').first<{ priority_id: string }>('priority_id');
    if (!priority?.priority_id) throw new Error('Expected seeded priority');
    priorityId = priority.priority_id;

    const user = await tenantTable('users').first<{ user_id: string }>('user_id');
    if (!user?.user_id) throw new Error('Expected seeded user');
    enteredByUserId = user.user_id;
  }, 180_000);

  afterEach(async () => {
    await tenantDb(db, tenantId).table('inbound_email_outbox').where({ tenant: tenantId }).delete();
    await tenantDb(db, tenantId).table('inbound_email_artifacts').where({ tenant: tenantId }).delete();
    await tenantDb(db, tenantId).table('inbound_email_effects').where({ tenant: tenantId }).delete();
    await tenantDb(db, tenantId).table('inbound_email_inbox').where({ tenant: tenantId }).delete();
    await tenantDb(db, tenantId).table('inbound_email_ingress').where({ tenant: tenantId }).delete();
    await tenantDb(db, tenantId).table('email_processed_attachments').where({ tenant: tenantId }).delete();
    await tenantDb(db, tenantId).table('email_processed_messages').where({ tenant: tenantId }).delete();
    await tenantDb(db, tenantId).table('email_sending_logs').where({ tenant: tenantId }).delete();
    for (const ticketId of createdTicketIds.splice(0)) {
      try {
        await deleteTicketRows(ticketId);
      } catch {
        // best effort; the seeded tickets stay untouched by this suite
      }
    }
    storageObjects.clear();
    while (cleanup.length) {
      const fn = cleanup.pop();
      if (fn) await fn();
    }
  });

  afterAll(async () => {
    process.env.UNIFIED_INBOUND_EMAIL_DURABLE_MODE = 'off';
    if (db) await db.destroy();
  });

  it('crash after inbox claim before core writes: replay creates exactly one ticket + comment', async () => {
    const { providerId } = await setupProvider({ mailbox: 'inbox@example.com', providerType: 'google' });
    const messageId = `crash-${randomUUID()}@example.com`;
    const rawMime = buildMime({
      from: 'sender@example.com',
      to: 'inbox@example.com',
      subject: 'Crash replay',
      messageId,
      text: 'body',
    });
    const { inboxId } = await stageAndUpsertInbox({ providerId, providerType: 'google', rawMime, messageId });

    // First worker claims the row then "crashes": expire the lease.
    const { claimInbox } = await import('@alga-psa/shared/services/email/inboundEmailDurableStore');
    const claim = await claimInbox(db, { tenant: tenantId, inbox_id: inboxId, owner: 'crashed-worker', leaseTtlMs: 30_000, allowRetryable: true });
    expect(claim.claimed).toBe(true);
    await tenantDb(db, tenantId).table('inbound_email_inbox')
      .where({ tenant: tenantId, inbox_id: inboxId })
      .update({ lease_expires_at: db.raw("now() - interval '5 minutes'") });

    // Second worker replays after lease expiry.
    const result = await processInbox(inboxId, 'replay-worker');
    expect(result.disposition).toBe('ack');
    expect(result.outcome).toBe('created');

    expect(await countTicketsByMessageId(messageId)).toBe(1);
    expect(await countCommentsByMessageId(messageId)).toBe(1);

    const effects = await tenantTable('inbound_email_effects').count<{ count: string }[]>('* as count').first();
    expect(Number(effects?.count)).toBe(2);

    const inbox = await tenantTable('inbound_email_inbox').where({ inbox_id: inboxId }).first();
    expect(inbox.status).toBe('succeeded');
    expect(inbox.outcome_kind).toBe('created');
    expect(inbox.ticket_id).toBeTruthy();
    expect(inbox.comment_id).toBeTruthy();
    expect(inbox.lease_token).toBeNull();
    createdTicketIds.push(inbox.ticket_id);
  });

  it('crash after ticket insert before commit: everything rolls back, replay completes once', async () => {
    const { providerId } = await setupProvider({ mailbox: 'inbox2@example.com', providerType: 'microsoft' });
    const messageId = `atomic-${randomUUID()}@example.com`;
    const rawMime = buildMime({ from: 'sender@example.com', to: 'inbox2@example.com', subject: 'Atomic', messageId, text: 'body' });
    const { inboxId, normalizedMessageId } = await stageAndUpsertInbox({ providerId, providerType: 'microsoft', rawMime, messageId });

    const { processInboundInbox } = await import('@alga-psa/shared/services/email/inboundEmailCoreProcessor');
    const { claimInbox } = await import('@alga-psa/shared/services/email/inboundEmailDurableStore');
    const { withAdminTransaction } = await import('@alga-psa/db');
    const { createTicketFromEmail, createCommentFromEmail } = await import('@alga-psa/shared/workflow/actions/emailWorkflowActions');
    const { InboundEmailOutboxEventPublisher } = await import('@alga-psa/shared/workflow/adapters/inboundEmailOutboxEventPublisher');

    // Simulate a worker that claims and then crashes mid-transaction: perform
    // the ticket + comment writes and throw before commit.
    const claim = await claimInbox(db, { tenant: tenantId, inbox_id: inboxId, owner: 'mid-crash-worker', leaseTtlMs: 30_000, allowRetryable: true });
    expect(claim.claimed).toBe(true);
    await expect(
      withAdminTransaction(async (trx: any) => {
        const publisher = new InboundEmailOutboxEventPublisher({ trx, tenantId, inboxId, suppressCommentEmail: true });
        const ticket = await createTicketFromEmail(
          {
            title: 'Atomic ticket',
            description: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'body', styles: {} }] }]),
            client_id: clientId,
            source: 'email',
            board_id: boardId,
            status_id: statusId,
            priority_id: priorityId,
            email_metadata: { messageId, providerId },
          },
          tenantId,
          undefined,
          { existingConnection: trx, eventPublisher: publisher }
        );
        await createCommentFromEmail(
          {
            ticket_id: ticket.ticket_id,
            content: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'body', styles: {} }] }]),
            source: 'email',
            suppressTechEmailNotification: true,
            metadata: { email: { messageId } },
          },
          tenantId,
          undefined,
          { existingConnection: trx, inboxId, eventPublisher: publisher }
        );
        throw new Error('simulated crash before commit');
      })
    ).rejects.toThrow('simulated crash before commit');

    // No ticket/comment/effects/outbox survived the rollback.
    expect(await countTicketsByMessageId(messageId)).toBe(0);
    expect(await countCommentsByMessageId(messageId)).toBe(0);
    expect(await countRows('inbound_email_effects')).toBe(0);
    expect(await countRows('inbound_email_outbox')).toBe(0);

    // Lease is still held by the crashed worker; expire it and replay.
    await tenantDb(db, tenantId).table('inbound_email_inbox')
      .where({ tenant: tenantId, inbox_id: inboxId })
      .update({ lease_expires_at: db.raw("now() - interval '5 minutes'") });

    const result = await runProcessor(inboxId, 'replay-atomic', processInboundInbox);
    expect(result.disposition).toBe('ack');
    expect(result.outcome).toBe('created');
    expect(await countTicketsByMessageId(messageId)).toBe(1);
    expect(await countCommentsByMessageId(messageId)).toBe(1);
    expect(await countRows('inbound_email_effects')).toBe(2);

    const inbox = await tenantTable('inbound_email_inbox').where({ inbox_id: inboxId }).first();
    expect(inbox.status).toBe('succeeded');
    expect(inbox.normalized_message_id).toBe(normalizedMessageId);
    createdTicketIds.push(inbox.ticket_id);
  });

  it('crash after commit before ACK: redelivery returns stored IDs without new effects', async () => {
    const { providerId } = await setupProvider({ mailbox: 'inbox3@example.com', providerType: 'google' });
    const messageId = `replay-${randomUUID()}@example.com`;
    const rawMime = buildMime({ from: 'sender@example.com', to: 'inbox3@example.com', subject: 'Replay', messageId, text: 'body' });
    const { inboxId } = await stageAndUpsertInbox({ providerId, providerType: 'google', rawMime, messageId });

    const first = await processInbox(inboxId, 'first-worker');
    expect(first.disposition).toBe('ack');
    expect(first.outcome).toBe('created');
    const ticketId = first.ticketId;
    const commentId = first.commentId;

    // Redelivery (e.g. Redis reclaim) reads the terminal inbox and returns the
    // same IDs without any new entity/effect/outbox/artifact rows.
    const second = await processInbox(inboxId, 'redelivery-worker');
    expect(second.disposition).toBe('ack');
    expect(second.ticketId).toBe(ticketId);
    expect(second.commentId).toBe(commentId);

    expect(await countTicketsByMessageId(messageId)).toBe(1);
    expect(await countCommentsByMessageId(messageId)).toBe(1);
    expect(await countRows('inbound_email_effects')).toBe(2);
    const outboxRows = await tenantTable('inbound_email_outbox').where({ inbox_id: inboxId }).select('event_key');
    const keys = outboxRows.map((r: any) => r.event_key).sort();
    expect(keys).toContain('ticket-created');
    expect(keys).toContain('initial-comment-created');
    createdTicketIds.push(ticketId);
  });

  it('concurrent same identity: exactly one ticket/comment/effect per type', async () => {
    const { providerId } = await setupProvider({ mailbox: 'inbox4@example.com', providerType: 'google' });
    const messageId = `concurrent-${randomUUID()}@example.com`;
    const rawMime = buildMime({ from: 'sender@example.com', to: 'inbox4@example.com', subject: 'Concurrent', messageId, text: 'body' });
    const { inboxId } = await stageAndUpsertInbox({ providerId, providerType: 'google', rawMime, messageId });

    const results = await Promise.allSettled([
      processInbox(inboxId, 'worker-a'),
      processInbox(inboxId, 'worker-b'),
    ]);
    const acked = results.filter((r) => r.status === 'fulfilled');
    expect(acked.length).toBeGreaterThanOrEqual(1);

    expect(await countTicketsByMessageId(messageId)).toBe(1);
    expect(await countCommentsByMessageId(messageId)).toBe(1);
    expect(await countRows('inbound_email_effects')).toBe(2);
    expect(await countRows('inbound_email_inbox')).toBe(1);

    const inbox = await tenantTable('inbound_email_inbox').where({ inbox_id: inboxId }).first();
    expect(inbox.status).toBe('succeeded');
    createdTicketIds.push(inbox.ticket_id);
  });

  it('stale fencing token cannot terminal-write a superseded claim', async () => {
    const { providerId } = await setupProvider({ mailbox: 'inbox5@example.com', providerType: 'google' });
    const messageId = `fence-${randomUUID()}@example.com`;
    const rawMime = buildMime({ from: 'sender@example.com', to: 'inbox5@example.com', subject: 'Fence', messageId, text: 'body' });
    const { inboxId } = await stageAndUpsertInbox({ providerId, providerType: 'google', rawMime, messageId });

    const { claimInbox, reclaimInbox, transitionInbox } = await import('@alga-psa/shared/services/email/inboundEmailDurableStore');
    const first = await claimInbox(db, { tenant: tenantId, inbox_id: inboxId, owner: 'old-worker', leaseTtlMs: 30_000, allowRetryable: true });
    expect(first.claimed).toBe(true);

    // A different owner cannot write with the current token (owner fence).
    const intruderWrite = await transitionInbox(db, {
      tenant: tenantId,
      inbox_id: inboxId,
      owner: 'intruder',
      token: String(first.row.lease_token),
      version: Number(first.row.lease_version),
      status: 'terminal_failed',
      outcome_reason: 'intruder write should not land',
    });
    expect(intruderWrite).toBe(false);

    // Reclaim installs a new token/version once the lease expires.
    await tenantDb(db, tenantId).table('inbound_email_inbox')
      .where({ tenant: tenantId, inbox_id: inboxId })
      .update({ lease_expires_at: db.raw("now() - interval '5 minutes'") });
    const reclaim = await reclaimInbox(db, { tenant: tenantId, inbox_id: inboxId, owner: 'new-worker', leaseTtlMs: 30_000 });
    expect(reclaim.claimed).toBe(true);
    const newToken = String(reclaim.row.lease_token);
    expect(newToken).not.toBe(String(first.row.lease_token));

    // The old worker's token now fails after the superseding reclaim.
    const staleAfterReclaim = await transitionInbox(db, {
      tenant: tenantId,
      inbox_id: inboxId,
      owner: 'old-worker',
      token: String(first.row.lease_token),
      version: Number(first.row.lease_version),
      status: 'terminal_failed',
      outcome_reason: 'stale write should not land',
    });
    expect(staleAfterReclaim).toBe(false);

    // The orchestrator reclaims the expired lease itself and completes normally
    // with the fresh fence.
    await tenantDb(db, tenantId).table('inbound_email_inbox')
      .where({ tenant: tenantId, inbox_id: inboxId })
      .update({ lease_expires_at: db.raw("now() - interval '5 minutes'") });
    const result = await runProcessor(inboxId, 'new-worker', (await import('@alga-psa/shared/services/email/inboundEmailCoreProcessor')).processInboundInbox);
    expect(result.disposition).toBe('ack');
    expect(result.outcome).toBe('created');
    const inbox = await tenantTable('inbound_email_inbox').where({ inbox_id: inboxId }).first();
    expect(inbox.status).toBe('succeeded');
    createdTicketIds.push(inbox.ticket_id);
  });

  it('reply path: duplicate reply creates no new ticket and one reply comment', async () => {
    const { providerId } = await setupProvider({ mailbox: 'inbox6@example.com', providerType: 'google' });
    const originalMessageId = `orig-${randomUUID()}@example.com`;
    const originalMime = buildMime({ from: 'client@example.com', to: 'inbox6@example.com', subject: 'Original', messageId: originalMessageId, text: 'hello' });
    const original = await stageAndUpsertInbox({ providerId, providerType: 'google', rawMime: originalMime, messageId: originalMessageId });
    const originalResult = await processInbox(original.inboxId, 'orig-worker');
    expect(originalResult.outcome).toBe('created');
    const originalTicketId = originalResult.ticketId;

    // Seed the outbound sending log so the reply resolves to the original
    // ticket via the standard outbound Message-ID threading path.
    await tenantTable('email_sending_logs').insert({
      tenant: tenantId,
      message_id: `<${originalMessageId}>`,
      provider_id: String(providerId),
      provider_type: 'google',
      from_address: 'inbox6@example.com',
      to_addresses: JSON.stringify([{ email: 'client@example.com' }]),
      status: 'sent',
      sent_at: db.fn.now(),
      entity_type: 'ticket',
      entity_id: originalTicketId,
      rfc_message_id: `<${originalMessageId}>`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await tenantDb(db, tenantId).table('email_sending_logs').where({ tenant: tenantId }).delete();
    });

    // Reply references the original message id.
    const replyMessageId = `reply-${randomUUID()}@example.com`;
    const replyMime = buildMime({
      from: 'client@example.com',
      to: 'inbox6@example.com',
      subject: 'Re: Original',
      messageId: replyMessageId,
      text: 'thanks',
      inReplyTo: originalMessageId,
      references: [originalMessageId],
    });
    const reply = await stageAndUpsertInbox({ providerId, providerType: 'google', rawMime: replyMime, messageId: replyMessageId });
    const replyResult = await processInbox(reply.inboxId, 'reply-worker');
    expect(replyResult.disposition).toBe('ack');
    expect(replyResult.outcome).toBe('replied');
    expect(replyResult.ticketId).toBe(originalTicketId);

    // The original ticket now carries its initial comment plus the reply comment.
    const comments = await tenantTable('comments')
      .where({ ticket_id: originalTicketId })
      .count<{ count: string }[]>('* as count')
      .first();
    expect(Number(comments?.count)).toBe(2);

    // No second ticket was created for the reply.
    const replyTickets = await tenantTable('tickets')
      .whereRaw("email_metadata->>'messageId' = ?", [replyMessageId])
      .count<{ count: string }[]>('* as count')
      .first();
    expect(Number(replyTickets?.count)).toBe(0);

    // Duplicate delivery of the reply adds nothing.
    const dup = await processInbox(reply.inboxId, 'reply-dup-worker');
    expect(dup.disposition).toBe('ack');
    expect(Number((await tenantTable('comments').where({ ticket_id: originalTicketId }).count<{ count: string }[]>('* as count').first())?.count)).toBe(2);
    expect(await countRows('inbound_email_effects')).toBe(3);

    createdTicketIds.push(originalTicketId);
  });

  it('intentional rule skip is terminal, stores reason, and creates no effects', async () => {
    const { providerId } = await setupProvider({ mailbox: 'inbox7@example.com', providerType: 'google' });
    const messageId = `skip-${randomUUID()}@example.com`;
    const rawMime = buildMime({ from: 'sender@example.com', to: 'inbox7@example.com', subject: 'SKIPME please', messageId, text: 'body' });
    const { inboxId } = await stageAndUpsertInbox({ providerId, providerType: 'google', rawMime, messageId });

    await tenantTable('inbound_email_rules').insert({
      tenant: tenantId,
      id: randomUUID(),
      name: 'skip everything with SKIPME',
      is_active: true,
      position: 1,
      provider_ids: null,
      conditions: JSON.stringify([{ field: 'subject', operator: 'contains', value: 'SKIPME' }]),
      action_type: 'skip',
      action_config: JSON.stringify({}),
      on_no_match: 'proceed',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    cleanup.push(async () => {
      await tenantDb(db, tenantId).table('inbound_email_rules').where({ tenant: tenantId }).delete();
    });

    const result = await processInbox(inboxId, 'skip-worker');
    expect(result.disposition).toBe('ack');
    expect(result.outcome).toBe('skipped');

    const inbox = await tenantTable('inbound_email_inbox').where({ inbox_id: inboxId }).first();
    expect(inbox.status).toBe('skipped');
    expect(inbox.outcome_kind).toBe('skipped');
    expect(inbox.outcome_reason).toBe('rule_skip');
    expect(await countRows('inbound_email_effects')).toBe(0);
    expect(await countRows('inbound_email_artifacts')).toBe(0);
    expect(await countRows('inbound_email_outbox')).toBe(0);
    const skipTickets = await tenantTable('tickets')
      .whereRaw("email_metadata->>'messageId' = ?", [messageId])
      .count<{ count: string }[]>('* as count')
      .first();
    expect(Number(skipTickets?.count)).toBe(0);

    // Repeated delivery ACKs by reading the stored skip result.
    const dup = await processInbox(inboxId, 'skip-dup-worker');
    expect(dup.disposition).toBe('ack');
    expect(dup.outcome).toBe('skipped');
  });

  it('tenant isolation: same provider+message identity in another tenant creates its own inbox', async () => {
    const secondTenant = await tenantDb(db, 'tenant-discovery-2')
      .unscoped('tenants', 'isolation test creates a second tenant')
      .insert({
        tenant: randomUUID(),
        client_name: 'Isolation Tenant',
        email: 'isolation@example.com',
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      })
      .returning('tenant');
    const tenantB = secondTenant[0].tenant;
    cleanup.push(async () => {
      await tenantDb(db, tenantB).table('inbound_email_inbox').where({ tenant: tenantB }).delete();
      await tenantDb(db, tenantB).table('tenants').where({ tenant: tenantB }).delete();
    });

    // Insert the same identity in both tenants.
    const providerId = randomUUID();
    const normalized = `provider:google:${randomUUID()}`;
    const { upsertInbox, upsertIngress } = await import('@alga-psa/shared/services/email/inboundEmailDurableStore');
    for (const t of [tenantId, tenantB]) {
      const ingress = await upsertIngress(db, {
        tenant: t,
        provider_id: providerId,
        provider_type: 'google',
        ingress_key: `iso:${normalized}`,
        provider_pointer: { messageId: 'shared-msg' },
      });
      await upsertInbox(db, {
        tenant: t,
        ingress_id: ingress.ingress_id,
        provider_id: providerId,
        provider_type: 'google',
        normalized_message_id: normalized,
        provider_message_id: 'shared-msg',
        rfc_message_id: null,
        source_object_key: 'k/a',
        source_sha256: 'deadbeef',
        source_size_bytes: 1,
        source_staged_at: new Date(),
        envelope: {},
      });
    }

    const a = await tenantDb(db, tenantId).table('inbound_email_inbox').where({ tenant: tenantId, normalized_message_id: normalized }).first();
    const b = await tenantDb(db, tenantB).table('inbound_email_inbox').where({ tenant: tenantB, normalized_message_id: normalized }).first();
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a.inbox_id).not.toBe(b.inbox_id);
  });

  it('queued V2 wake-up and durable store scan find the inbox back after redis loss', async () => {
    const { providerId } = await setupProvider({ mailbox: 'inbox8@example.com', providerType: 'google' });
    const messageId = `sweep-${randomUUID()}@example.com`;
    const rawMime = buildMime({ from: 'sender@example.com', to: 'inbox8@example.com', subject: 'Sweep', messageId, text: 'body' });
    const { inboxId } = await stageAndUpsertInbox({ providerId, providerType: 'google', rawMime, messageId });

    const { findDueInbox } = await import('@alga-psa/shared/services/email/inboundEmailDurableStore');
    const due = await findDueInbox(db, { tenant: tenantId, limit: 10 });
    expect(due.some((row: any) => row.inbox_id === inboxId)).toBe(true);

    const result = await processInbox(inboxId, 'sweep-worker');
    expect(result.disposition).toBe('ack');
    createdTicketIds.push(result.ticketId);
  });
});
