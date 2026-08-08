import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import Knex from 'knex';
import { randomUUID, createHash } from 'crypto';
import { NextRequest } from 'next/server';
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

// Capture the legacy V1 pointer handoff so the shadow-mode producer regression
// test can assert producers fall through to it (legacy stays authoritative).
const v1EnqueueMock = vi.fn(async (input: any) => ({
  job: { ...input, jobId: `v1-${randomUUID()}`, schemaVersion: 1, enqueuedAt: new Date().toISOString(), attempt: 0, maxAttempts: 5 },
  queueDepth: 1,
}));
const v2EnqueueMock = vi.fn(async (input: any) => ({
  job: { ...input, jobId: `v2-${randomUUID()}`, schemaVersion: 2, enqueuedAt: new Date().toISOString(), attempt: 0, maxAttempts: 5 },
  queueDepth: 1,
}));
vi.mock('@alga-psa/shared/services/email/unifiedInboundEmailQueue', () => ({
  enqueueUnifiedInboundEmailQueueJob: (...args: any[]) => v1EnqueueMock(...args),
  getInboundEmailRedisClient: vi.fn(async () => ({})),
}));
vi.mock('@alga-psa/shared/services/email/unifiedInboundEmailQueueV2', () => ({
  enqueueInboundEmailDurableJob: (...args: any[]) => v2EnqueueMock(...args),
  getInboundEmailDurableRedisClient: vi.fn(async () => ({})),
  getUnifiedInboundEmailQueueV2Config: () => ({
    claimTtlMs: 120_000,
    handlerTimeoutMs: 90_000,
    heartbeatIntervalMs: 30_000,
    maxAttempts: 5,
    claimBlockSeconds: 1,
    readyQueueKey: 'r',
    processingQueueKey: 'p',
    inflightHashKey: 'h',
    inflightLeaseKey: 'l',
    delayedKey: 'd',
    delayedDataKey: 'dd',
    deadLetterQueueKey: 'dlq',
  }),
}));

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

const { gmailAdapterMock, googleProviderConfigMock, microsoftFetchMock, microsoftGraphAdapterMock, publishEventMock } = vi.hoisted(() => ({
  gmailAdapterMock: {
    connect: vi.fn(async () => undefined),
    listMessagesSince: vi.fn(async () => ['gmail-msg-1']),
    downloadMessageSource: vi.fn(async () => Buffer.from('From: a@b.c\r\nTo: x@y.z\r\nSubject: G\r\n\r\nbody\r\n')),
    close: vi.fn(async () => undefined),
  },
  googleProviderConfigMock: {
    fetchGoogleProviderConfig: vi.fn(async () => ({
      provider: { id: 'provider-id', tenant: 'tenant' },
      googleConfig: { history_id: '1' },
      config: {},
    })),
  },
  microsoftFetchMock: vi.fn(async () => ({
    id: 'ms-1',
    rawMime: 'From: Sender <sender@example.com>\r\nTo: Support <inbox@example.com>\r\nSubject: MS\r\nMessage-ID: <ms-1@example.com>\r\n\r\nbody\r\n',
  })),
  microsoftGraphAdapterMock: {
    listMessagesReceivedSince: vi.fn(async () => []),
    ensureTokenHealthy: vi.fn(async () => undefined),
    cleanupOrphanedSubscriptions: vi.fn(async () => 1),
    renewWebhookSubscription: vi.fn(async () => undefined),
    initializeWebhook: vi.fn(async () => ({ success: true })),
    deleteWebhookSubscription: vi.fn(async () => undefined),
    getConfig: vi.fn(async () => ({})),
  },
  publishEventMock: vi.fn(async () => undefined),
}));

vi.mock('@alga-psa/shared/services/email/providers/GmailAdapter', () => ({
  GmailAdapter: vi.fn(() => gmailAdapterMock),
}));

vi.mock('@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter', () => ({
  MicrosoftGraphAdapter: vi.fn(() => microsoftGraphAdapterMock),
}));

vi.mock('@alga-psa/shared/services/email/unifiedInboundEmailQueueJobProcessor', () => ({
  ...googleProviderConfigMock,
  fetchMicrosoftMessageForPointer: (...args: any[]) => microsoftFetchMock(...args),
  fetchImapMessageForPointer: vi.fn(async () => ({ id: 'imap-1' })),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: (...args: any[]) => publishEventMock(...args),
  publishWorkflowEvent: vi.fn(async () => undefined),
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
    await tenantDb(db, tenantId).table('inbound_email_event_deliveries').where({ tenant: tenantId }).delete();
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
    v1EnqueueMock.mockClear();
    v2EnqueueMock.mockClear();
    publishEventMock.mockClear();
    microsoftFetchMock.mockReset();
    microsoftFetchMock.mockResolvedValue({
      id: 'ms-1',
      rawMime: 'From: Sender <sender@example.com>\r\nTo: Support <inbox@example.com>\r\nSubject: MS\r\nMessage-ID: <ms-1@example.com>\r\n\r\nbody\r\n',
    });
    microsoftGraphAdapterMock.listMessagesReceivedSince.mockReset();
    microsoftGraphAdapterMock.listMessagesReceivedSince.mockResolvedValue([]);
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

  it('shadow mode: legacy creates exactly one ticket, inbox stays non-terminal, enforce reconciles', async () => {
    process.env.UNIFIED_INBOUND_EMAIL_DURABLE_MODE = 'shadow';
    try {
      const { providerId } = await setupProvider({ mailbox: 'inbox-shadow@example.com', providerType: 'google' });
      const messageId = `shadow-${randomUUID()}@example.com`;
      const rawMime = buildMime({ from: 'sender@example.com', to: 'inbox-shadow@example.com', subject: 'Shadow', messageId, text: 'body' });

      // Producer behavior in shadow: ingress persisted for coverage, but the
      // handoff must NOT be diverted (durable: true, mode: shadow) so the
      // webhook handlers fall through to the legacy V1 enqueue.
      const { persistIngressPointer } = await import('@alga-psa/shared/services/email/inboundEmailProducer');
      const produced = await persistIngressPointer({
        tenant: tenantId,
        providerId,
        providerType: 'google',
        pointer: {
          providerType: 'google',
          historyId: '1',
          pubsubMessageId: `pub-${messageId}`,
          providerMessageId: messageId,
        },
      });
      expect(produced.durable).toBe(true);
      expect(produced.mode).toBe('shadow');
      expect(produced.ingressId).toBeTruthy();

      // The durable path stages the source + inbox row for coverage.
      const { inboxId, normalizedMessageId } = await stageAndUpsertInbox({ providerId, providerType: 'google', rawMime, messageId });
      const { processInboundInbox } = await import('@alga-psa/shared/services/email/inboundEmailCoreProcessor');

      // Shadow process_inbox handling must NOT create entities or terminal-write:
      // it releases the claim and leaves the row non-terminal.
      const shadowResult = await processInboundInbox({ tenantId, inboxId, owner: 'shadow-worker', leaseTtlMs: 30_000, mode: 'shadow' });
      expect(shadowResult.disposition).toBe('ack');
      const afterShadow = await tenantDb(db, tenantId).table('inbound_email_inbox').where({ inbox_id: inboxId }).first();
      expect(afterShadow.status).toBe('received');
      expect(afterShadow.completed_at).toBeNull();
      expect(afterShadow.lease_token).toBeNull();
      expect(await countTicketsByMessageId(messageId)).toBe(0);
      expect(await countRows('inbound_email_effects')).toBe(0);

      // Legacy path (authoritative in shadow) creates exactly one ticket + comment.
      const { parseStagedMimeIntoEmailDetails } = await import('@alga-psa/shared/services/email/inboundEmailSourceStager');
      const { readStagedSourceMime } = await import('@alga-psa/shared/services/email/inboundEmailSourceStager');
      const inbox = await tenantDb(db, tenantId).table('inbound_email_inbox').where({ inbox_id: inboxId }).first();
      const stagedBuffer = await readStagedSourceMime({
        tenant: tenantId,
        providerId,
        objectKey: inbox.source_object_key,
        expectedSha256: inbox.source_sha256,
      });
      const parsed = await parseStagedMimeIntoEmailDetails({
        tenant: tenantId,
        providerId,
        providerType: 'google',
        rawMime: stagedBuffer,
        fallbackProviderMessageId: messageId,
      });
      const { processInboundEmailInApp } = await import('@alga-psa/shared/services/email/processInboundEmailInApp');
      const legacy = await processInboundEmailInApp({ tenantId, providerId, emailData: parsed.emailData });
      expect(legacy.outcome).toBe('created');
      expect(await countTicketsByMessageId(messageId)).toBe(1);
      const legacyTicketId = (legacy as any).ticketId as string;
      createdTicketIds.push(legacyTicketId);

      // Enforce-mode processing reconciles the legacy-created entities instead
      // of duplicating or dropping.
      process.env.UNIFIED_INBOUND_EMAIL_DURABLE_MODE = 'enforce';
      const enforceResult = await processInboundInbox({ tenantId, inboxId, owner: 'enforce-worker', leaseTtlMs: 30_000, mode: 'enforce' });
      expect(enforceResult.disposition).toBe('ack');
      expect(enforceResult.outcome).toBe('reconciled');
      expect(enforceResult.ticketId).toBe(legacyTicketId);

      expect(await countTicketsByMessageId(messageId)).toBe(1);
      expect(await countCommentsByMessageId(messageId)).toBe(1);
      expect(await countRows('inbound_email_effects')).toBe(2);

      const terminalInbox = await tenantDb(db, tenantId).table('inbound_email_inbox').where({ inbox_id: inboxId }).first();
      expect(terminalInbox.status).toBe('succeeded');
      expect(terminalInbox.outcome_kind).toBe('reconciled');
      expect(terminalInbox.normalized_message_id).toBe(normalizedMessageId);

      // Terminal replay: repeated delivery returns the same IDs, no new rows.
      const replay = await processInboundInbox({ tenantId, inboxId, owner: 'replay-worker', leaseTtlMs: 30_000, mode: 'enforce' });
      expect(replay.disposition).toBe('ack');
      expect(replay.ticketId).toBe(legacyTicketId);
      expect(await countTicketsByMessageId(messageId)).toBe(1);
      expect(await countRows('inbound_email_effects')).toBe(2);
    } finally {
      process.env.UNIFIED_INBOUND_EMAIL_DURABLE_MODE = 'enforce';
    }
  });

  it('webhook producer falls through to legacy enqueue in shadow mode but diverts in enforce', async () => {
    const { providerId } = await setupProvider({ mailbox: 'inbox-shadow-webhook@example.com', providerType: 'imap' });
    process.env.IMAP_WEBHOOK_SECRET = 'shadow-test-secret';
    cleanup.push(async () => {
      delete process.env.IMAP_WEBHOOK_SECRET;
    });

    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');
    const messageId = `imap-shadow-${randomUUID()}@example.com`;

    const callHandler = async () => {
      const req = new NextRequest('http://localhost:3000/api/email/webhooks/imap', {
        method: 'POST',
        headers: { 'x-imap-webhook-secret': 'shadow-test-secret', 'content-type': 'application/json' },
        body: JSON.stringify({
          providerId,
          tenant: tenantId,
          tenantId,
          pointer: { mailbox: 'INBOX', uid: '99', uidValidity: '7', messageId },
        }),
      });
      const res = await POST(req);
      return res.json();
    };

    // Shadow: the handler must persist ingress for coverage but NOT divert the
    // handoff — legacy V1 enqueue still happens so the message is processed.
    process.env.UNIFIED_INBOUND_EMAIL_DURABLE_MODE = 'shadow';
    const shadowBody = await callHandler();
    expect(shadowBody.handoff).toBe('unified_pointer_queue');
    expect(v1EnqueueMock).toHaveBeenCalledTimes(1);
    const ingressRows = await tenantDb(db, tenantId).table('inbound_email_ingress').count<{ count: string }[]>('* as count').first();
    expect(Number(ingressRows?.count)).toBe(1);

    // Enforce: the handler diverts to the durable ingress and must NOT enqueue
    // a legacy pointer (which would double-process under the durable pipeline).
    process.env.UNIFIED_INBOUND_EMAIL_DURABLE_MODE = 'enforce';
    v1EnqueueMock.mockClear();
    const enforceBody = await callHandler();
    expect(enforceBody.handoff).toBe('durable_ingress');
    expect(v1EnqueueMock).not.toHaveBeenCalled();
  });

  it('retryable failure gets backoff + error provenance and reclaims to success via the sweeper', async () => {
    const { providerId } = await setupProvider({ mailbox: 'retry@example.com', providerType: 'google' });
    const messageId = `retry-${randomUUID()}@example.com`;
    const rawMime = buildMime({ from: 'sender@example.com', to: 'retry@example.com', subject: 'Retry', messageId, text: 'body' });
    const { inboxId } = await stageAndUpsertInbox({ providerId, providerType: 'google', rawMime, messageId });

    const { processInboundInbox } = await import('@alga-psa/shared/services/email/inboundEmailCoreProcessor');
    const { claimInbox, findDueInbox } = await import('@alga-psa/shared/services/email/inboundEmailDurableStore');
    const { sweepTenantDurableWork } = await import('@alga-psa/shared/services/email/inboundEmailRecovery');

    // Force a retryable failure by making the staged source temporarily
    // unreadable (object gone). attempt_count becomes 1.
    const inboxRow = await tenantTable('inbound_email_inbox').where({ inbox_id: inboxId }).first();
    storageObjects.delete(String(inboxRow.source_object_key));
    const firstResult = await processInboundInbox({ tenantId, inboxId, owner: 'retry-worker', leaseTtlMs: 30_000, mode: 'enforce' });
    expect(firstResult.disposition).toBe('retry');

    const afterFail = await tenantTable('inbound_email_inbox').where({ inbox_id: inboxId }).first();
    expect(afterFail.status).toBe('retryable_failed');
    expect(afterFail.next_attempt_at).toBeTruthy();
    expect(afterFail.last_error).toContain('object not found');
    expect(Number(afterFail.attempt_count)).toBe(1);

    // Not due yet: claim refuses and the row is deferred, never classified as a duplicate.
    const notDue = await claimInbox(db, { tenant: tenantId, inbox_id: inboxId, owner: 'other-worker', leaseTtlMs: 30_000, allowRetryable: true });
    expect(notDue.claimed).toBe(false);
    expect(notDue.reason).toBe('not_due');

    // Make it due and restore the source, then the sweeper re-enqueues it.
    await tenantTable('inbound_email_inbox')
      .where({ inbox_id: inboxId })
      .update({ next_attempt_at: db.raw("now() - interval '1 minute'") });
    const due = await findDueInbox(db, { tenant: tenantId, limit: 10 });
    expect(due.some((row: any) => row.inbox_id === inboxId && row.status === 'retryable_failed')).toBe(true);

    storageProviderMock.upload(rawMime, String(inboxRow.source_object_key));
    const sweep = await sweepTenantDurableWork(tenantId, 10);
    expect(sweep.enqueued.inbox).toBeGreaterThanOrEqual(1);
    expect(v2EnqueueMock).toHaveBeenCalledWith(expect.objectContaining({ workType: 'process_inbox', tenantId, recordId: inboxId }));

    // The reclaimed processing succeeds and lands the row terminal.
    const replay = await processInboundInbox({ tenantId, inboxId, owner: 'replay-worker', leaseTtlMs: 30_000, mode: 'enforce' });
    expect(replay.disposition).toBe('ack');
    expect(replay.outcome).toBe('created');

    const terminal = await tenantTable('inbound_email_inbox').where({ inbox_id: inboxId }).first();
    expect(terminal.status).toBe('succeeded');
    expect(await countTicketsByMessageId(messageId)).toBe(1);
    expect(await countCommentsByMessageId(messageId)).toBe(1);
    createdTicketIds.push(terminal.ticket_id);
  });

  it('sweeper re-enqueues received, due retryable_failed, and expired-processing inbox rows', async () => {
    const { providerId } = await setupProvider({ mailbox: 'sweep-classes@example.com', providerType: 'google' });
    const { sweepTenantDurableWork } = await import('@alga-psa/shared/services/email/inboundEmailRecovery');
    const { claimInbox } = await import('@alga-psa/shared/services/email/inboundEmailDurableStore');

    const stageOne = async (tag: string) => {
      const messageId = `${tag}-${randomUUID()}@example.com`;
      const rawMime = buildMime({ from: 's@example.com', to: 'sweep-classes@example.com', subject: tag, messageId, text: 'x' });
      const { inboxId } = await stageAndUpsertInbox({ providerId, providerType: 'google', rawMime, messageId });
      return { inboxId, messageId };
    };

    // Class 1: `received` (crash between ingress persist and enqueue).
    const received = await stageOne('received');
    // Class 2: due `retryable_failed`.
    const retryable = await stageOne('retryable');
    await claimInbox(db, { tenant: tenantId, inbox_id: retryable.inboxId, owner: 'crashed', leaseTtlMs: 30_000, allowRetryable: true });
    await tenantTable('inbound_email_inbox')
      .where({ inbox_id: retryable.inboxId })
      .update({ status: 'retryable_failed', next_attempt_at: db.raw("now() - interval '1 minute'") });
    // Class 3: expired `processing` (crash mid-processing).
    const processing = await stageOne('processing');
    await claimInbox(db, { tenant: tenantId, inbox_id: processing.inboxId, owner: 'crashed', leaseTtlMs: 30_000, allowRetryable: true });
    await tenantTable('inbound_email_inbox')
      .where({ inbox_id: processing.inboxId })
      .update({ lease_expires_at: db.raw("now() - interval '5 minutes'") });

    v2EnqueueMock.mockClear();
    const sweep = await sweepTenantDurableWork(tenantId, 10);
    expect(sweep.enqueued.inbox).toBeGreaterThanOrEqual(3);
    const enqueuedIds = v2EnqueueMock.mock.calls
      .map((call: any) => call[0])
      .filter((job: any) => job.workType === 'process_inbox')
      .map((job: any) => job.recordId);
    expect(enqueuedIds).toContain(received.inboxId);
    expect(enqueuedIds).toContain(retryable.inboxId);
    expect(enqueuedIds).toContain(processing.inboxId);

    // Each class processes to a real terminal state after the sweep wake-up.
    const { processInboundInbox } = await import('@alga-psa/shared/services/email/inboundEmailCoreProcessor');
    for (const { inboxId } of [received, retryable, processing]) {
      const result = await processInboundInbox({ tenantId, inboxId, owner: 'sweep-worker', leaseTtlMs: 30_000, mode: 'enforce' });
      expect(result.disposition).toBe('ack');
      const row = await tenantTable('inbound_email_inbox').where({ inbox_id: inboxId }).first();
      expect(row.status).toBe('succeeded');
      createdTicketIds.push(row.ticket_id);
    }
    expect(await countRows('inbound_email_inbox')).toBe(3);
  });

  it('a superseded zombie worker cannot create core effects inside the fenced transaction', async () => {
    const { providerId } = await setupProvider({ mailbox: 'zombie@example.com', providerType: 'google' });
    const messageId = `zombie-${randomUUID()}@example.com`;
    const rawMime = buildMime({ from: 'sender@example.com', to: 'zombie@example.com', subject: 'Zombie', messageId, text: 'body' });
    const { inboxId } = await stageAndUpsertInbox({ providerId, providerType: 'google', rawMime, messageId });

    const { claimInbox, reclaimInbox, lockInboxForUpdate, transitionInbox } = await import('@alga-psa/shared/services/email/inboundEmailDurableStore');
    const { withAdminTransaction } = await import('@alga-psa/db');
    const { processInboundInbox } = await import('@alga-psa/shared/services/email/inboundEmailCoreProcessor');

    const first = await claimInbox(db, { tenant: tenantId, inbox_id: inboxId, owner: 'zombie', leaseTtlMs: 30_000, allowRetryable: true });
    expect(first.claimed).toBe(true);
    const oldToken = String(first.row.lease_token);
    const oldVersion = Number(first.row.lease_version);

    // The zombie's lease expires. Its token is now dead: it cannot lock the row
    // inside the core transaction, so no ticket or comment is created and any
    // core write rolls back.
    await tenantTable('inbound_email_inbox').where({ inbox_id: inboxId }).update({ lease_expires_at: db.raw("now() - interval '5 minutes'") });
    await expect(
      withAdminTransaction(async (trx: any) => {
        const locked = await lockInboxForUpdate(trx, { tenant: tenantId, inbox_id: inboxId, token: oldToken, version: oldVersion });
        if (!locked) throw new Error('inbox_fence_superseded');
        throw new Error('zombie_should_never_reach_write');
      })
    ).rejects.toThrow('inbox_fence_superseded');

    expect(await countTicketsByMessageId(messageId)).toBe(0);
    expect(await countRows('inbound_email_effects')).toBe(0);

    // A new worker atomically reclaims the expired lease and completes normally
    // with exactly one ticket + comment; the zombie's superseded token stays dead.
    const result = await processInboundInbox({ tenantId, inboxId, owner: 'new-worker', leaseTtlMs: 30_000, mode: 'enforce' });
    expect(result.disposition).toBe('ack');
    expect(result.outcome).toBe('created');
    expect(await countTicketsByMessageId(messageId)).toBe(1);
    expect(await countCommentsByMessageId(messageId)).toBe(1);

    const staleWrite = await transitionInbox(db, {
      tenant: tenantId,
      inbox_id: inboxId,
      owner: 'zombie',
      token: oldToken,
      version: oldVersion,
      status: 'terminal_failed',
      outcome_reason: 'zombie write should not land after reclaim',
    });
    expect(staleWrite).toBe(false);
    const row = await tenantTable('inbound_email_inbox').where({ inbox_id: inboxId }).first();
    createdTicketIds.push(row.ticket_id);
  });

  it('exhausted retries dead-letter to terminal_failed instead of looping forever', async () => {
    const { providerId } = await setupProvider({ mailbox: 'deadletter@example.com', providerType: 'google' });
    const messageId = `deadletter-${randomUUID()}@example.com`;
    const rawMime = buildMime({ from: 'sender@example.com', to: 'deadletter@example.com', subject: 'DLQ', messageId, text: 'body' });
    const { inboxId } = await stageAndUpsertInbox({ providerId, providerType: 'google', rawMime, messageId });

    process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_MAX_ATTEMPTS = '3';
    cleanup.push(async () => {
      delete process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_MAX_ATTEMPTS;
    });

    const { processInboundInbox } = await import('@alga-psa/shared/services/email/inboundEmailCoreProcessor');
    const inboxRow = await tenantTable('inbound_email_inbox').where({ inbox_id: inboxId }).first();
    storageObjects.delete(String(inboxRow.source_object_key));

    // Three failed processing attempts (backoff made due between attempts),
    // then the row must dead-letter into terminal_failed.
    const results: string[] = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (attempt > 1) {
        await tenantTable('inbound_email_inbox')
          .where({ inbox_id: inboxId })
          .update({ next_attempt_at: db.raw("now() - interval '1 minute'") });
      }
      const result = await processInboundInbox({ tenantId, inboxId, owner: `dlq-worker-${attempt}`, leaseTtlMs: 30_000, mode: 'enforce' });
      results.push(result.disposition);
    }
    expect(results).toEqual(['retry', 'retry', 'ack']);

    const row = await tenantTable('inbound_email_inbox').where({ inbox_id: inboxId }).first();
    expect(row.status).toBe('terminal_failed');
    expect(row.outcome_reason).toBe('max_attempts_exhausted');
    expect(row.last_error).toContain('object not found');
    expect(row.completed_at).toBeTruthy();
    expect(row.lease_token).toBeNull();

    // Repeated delivery reads the stored terminal failure and ACKs it; nothing loops.
    const again = await processInboundInbox({ tenantId, inboxId, owner: 'dlq-reader', leaseTtlMs: 30_000, mode: 'enforce' });
    expect(again.disposition).toBe('ack');
    expect(again.outcome).toBe('terminal_failed');
    expect(await countTicketsByMessageId(messageId)).toBe(0);
    expect(await countRows('inbound_email_effects')).toBe(0);
  });

  it('google staging advances the history cursor only after all sources stage; failure leaves it untouched', async () => {
    const { providerId } = await setupProvider({ mailbox: 'gmail-cursor@example.com', providerType: 'google' });
    const { persistIngressPointer } = await import('@alga-psa/shared/services/email/inboundEmailProducer');
    const { processIngressStageJob } = await import('@alga-psa/shared/services/email/inboundEmailIngressStagingWorker');

    const produced = await persistIngressPointer({
      tenant: tenantId,
      providerId,
      providerType: 'google',
      pointer: { providerType: 'google', historyId: '7', pubsubMessageId: 'pub-7' },
    });
    expect(produced.ingressId).toBeTruthy();

    // Successful staging advances google_email_provider_config.history_id to the
    // notification's history id ONLY after the inbox rows are durable.
    const okJob: any = {
      schemaVersion: 2,
      workType: 'stage_ingress',
      tenantId: tenantId,
      recordId: produced.ingressId,
      jobId: `stage-${randomUUID()}`,
      enqueuedAt: new Date().toISOString(),
      attempt: 0,
      maxAttempts: 5,
    };
    gmailAdapterMock.listMessagesSince.mockResolvedValue(['gmail-msg-1']);
    gmailAdapterMock.downloadMessageSource.mockImplementation(async (id: string) =>
      buildMime({ from: 'a@b.c', to: 'gmail-cursor@example.com', subject: 'Cursor', messageId: `gmail-${id}`, text: 'x' })
    );
    const ok = await processIngressStageJob(okJob, { signal: new AbortController().signal, renew: async () => true, registerPostgresLease: () => undefined });
    expect(ok.disposition).toBe('ack');

    const config = await tenantTable('google_email_provider_config').where({ email_provider_id: providerId }).first();
    expect(String(config.history_id)).toBe('7');
    const ingress = await tenantTable('inbound_email_ingress').where({ ingress_id: produced.ingressId }).first();
    expect(ingress.status).toBe('staged');

    // A staging failure (provider fetch fails) must NOT advance the cursor and
    // leaves the ingress retryable so the message stays fetchable next poll.
    const failed = await persistIngressPointer({
      tenant: tenantId,
      providerId,
      providerType: 'google',
      pointer: { providerType: 'google', historyId: '9', pubsubMessageId: 'pub-9' },
    });
    gmailAdapterMock.listMessagesSince.mockResolvedValue(['gmail-msg-2']);
    gmailAdapterMock.downloadMessageSource.mockRejectedValue(new Error('provider_unavailable_temporarily'));
    const failJob: any = {
      schemaVersion: 2,
      workType: 'stage_ingress',
      tenantId: tenantId,
      recordId: failed.ingressId,
      jobId: `stage-${randomUUID()}`,
      enqueuedAt: new Date().toISOString(),
      attempt: 0,
      maxAttempts: 5,
    };
    const failResult = await processIngressStageJob(failJob, { signal: new AbortController().signal, renew: async () => true, registerPostgresLease: () => undefined });
    expect(failResult.disposition).toBe('retry');

    const configAfter = await tenantTable('google_email_provider_config').where({ email_provider_id: providerId }).first();
    expect(String(configAfter.history_id)).toBe('7'); // unchanged
    const failedIngress = await tenantTable('inbound_email_ingress').where({ ingress_id: failed.ingressId }).first();
    expect(failedIngress.status).toBe('retryable_failed');
    expect(failedIngress.last_error).toContain('provider_unavailable_temporarily');
  });

  it('core processing succeeds from the staged source when the provider message is gone', async () => {
    const { providerId } = await setupProvider({ mailbox: 'source-gone@example.com', providerType: 'microsoft' });
    const messageId = `gone-${randomUUID()}@example.com`;
    const rawMime = buildMime({ from: 'sender@example.com', to: 'source-gone@example.com', subject: 'Gone', messageId, text: 'body' });
    const { inboxId } = await stageAndUpsertInbox({ providerId, providerType: 'microsoft', rawMime, messageId });

    // The provider-side message disappears: the ingress pointer is invalidated
    // (no way to re-fetch) and the provider config token is revoked. Processing
    // must reconstruct everything from the staged object alone.
    await tenantTable('inbound_email_ingress').where({ tenant: tenantId }).update({ provider_pointer: JSON.stringify({}) });
    await tenantTable('microsoft_email_provider_config').where({ email_provider_id: providerId }).update({ access_token: 'invalidated' });

    const result = await processInbox(inboxId, 'source-gone-worker');
    expect(result.disposition).toBe('ack');
    expect(result.outcome).toBe('created');
    expect(await countTicketsByMessageId(messageId)).toBe(1);
    expect(await countCommentsByMessageId(messageId)).toBe(1);
    const row = await tenantTable('inbound_email_inbox').where({ inbox_id: inboxId }).first();
    expect(row.status).toBe('succeeded');
    createdTicketIds.push(row.ticket_id);
  });

  it('legacy stuck-processing reconciliation links a pre-existing ticket/comment without duplicating', async () => {
    const { providerId } = await setupProvider({ mailbox: 'legacy-reconcile@example.com', providerType: 'microsoft' });
    const messageId = `legacy-${randomUUID()}@example.com`;
    const legacyMessageId = `microsoft:${messageId}`;

    // Simulate the incident: the old pipeline already created ticket + comment,
    // then died before completing the audit row (status stuck in `processing`).
    const { createTicketFromEmail, createCommentFromEmail } = await import('@alga-psa/shared/workflow/actions/emailWorkflowActions');
    const { withAdminTransaction } = await import('@alga-psa/db');
    await withAdminTransaction(async (trx: any) => {
      const ticket = await createTicketFromEmail(
        {
          title: 'Legacy stuck',
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
        { existingConnection: trx }
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
        { existingConnection: trx }
      );
    });
    const existingTicket = await tenantTable('tickets')
      .whereRaw("email_metadata->>'messageId' = ?", [messageId])
      .first('ticket_id');
    expect(existingTicket).toBeTruthy();
    const ticketId = String(existingTicket.ticket_id);
    createdTicketIds.push(ticketId);

    await tenantTable('email_processed_messages').insert({
      message_id: legacyMessageId,
      provider_id: providerId,
      tenant: tenantId,
      processed_at: new Date(Date.now() - 60_000),
      processing_status: 'processing',
      from_email: 'sender@example.com',
      subject: 'Legacy stuck',
      received_at: db.fn.now(),
      metadata: JSON.stringify({
        queueJobId: 'legacy-job',
        queueProvider: 'microsoft',
        pointer: { subscriptionId: 'sub', messageId },
        headersSnapshot: { messageId },
      }),
    });
    createdTicketIds.push(ticketId);

    const { backfillTenantLegacyRows } = await import('@alga-psa/shared/services/email/inboundEmailRecovery');
    const result = await backfillTenantLegacyRows(tenantId, 50);
    expect(result.imported).toBeGreaterThanOrEqual(1);

    const inbox = await tenantTable('inbound_email_inbox').where({ tenant: tenantId }).first();
    expect(inbox).toBeTruthy();
    expect(inbox.status).toBe('succeeded');
    expect(inbox.outcome_kind).toBe('reconciled');
    expect(inbox.legacy_imported).toBe(true);
    expect(inbox.ticket_id).toBe(ticketId);
    expect(inbox.comment_id).toBeTruthy();

    expect(await countTicketsByMessageId(messageId)).toBe(1);
    expect(await countCommentsByMessageId(messageId)).toBe(1);
    expect(await countRows('inbound_email_effects')).toBe(2);

    // The legacy audit row is preserved untouched (never deleted/overwritten).
    const legacyRow = await tenantTable('email_processed_messages').where({ message_id: legacyMessageId }).first();
    expect(legacyRow.processing_status).toBe('processing');
  });

  it('legacy stuck-processing with no entities and no pointer dead-letters as terminal_failed', async () => {
    const { providerId } = await setupProvider({ mailbox: 'legacy-unrecoverable@example.com', providerType: 'microsoft' });
    const messageId = `legacy-unrec-${randomUUID()}@example.com`;
    const legacyMessageId = `microsoft:${messageId}`;

    await tenantTable('email_processed_messages').insert({
      message_id: legacyMessageId,
      provider_id: providerId,
      tenant: tenantId,
      processed_at: new Date(Date.now() - 60_000),
      processing_status: 'processing',
      from_email: 'sender@example.com',
      subject: 'Legacy unrecoverable',
      received_at: db.fn.now(),
      metadata: JSON.stringify({
        queueJobId: 'legacy-job',
        queueProvider: 'microsoft',
        headersSnapshot: { messageId },
        // no pointer: the source cannot be re-fetched
      }),
    });

    const { backfillTenantLegacyRows } = await import('@alga-psa/shared/services/email/inboundEmailRecovery');
    const result = await backfillTenantLegacyRows(tenantId, 50);
    expect(result.imported).toBeGreaterThanOrEqual(1);

    const inbox = await tenantTable('inbound_email_inbox').where({ tenant: tenantId }).first();
    expect(inbox).toBeTruthy();
    expect(inbox.status).toBe('terminal_failed');
    expect(inbox.outcome_reason).toBe('legacy_processing_unrecoverable');
    expect(inbox.legacy_imported).toBe(true);
    expect(inbox.ticket_id).toBeNull();
    expect(await countRows('inbound_email_effects')).toBe(0);
    expect(await countTicketsByMessageId(messageId)).toBe(0);

    const legacyRow = await tenantTable('email_processed_messages').where({ message_id: legacyMessageId }).first();
    expect(legacyRow.processing_status).toBe('processing');
  });

  it('a crashed ingress claim (expired staging) is reclaimed by the sweeper, not stranded', async () => {
    const { providerId } = await setupProvider({ mailbox: 'ingress-stuck@example.com', providerType: 'microsoft' });
    const { upsertIngress, claimIngress, findDueIngress, reclaimIngress, transitionIngress } = await import('@alga-psa/shared/services/email/inboundEmailDurableStore');
    const { sweepTenantDurableWork } = await import('@alga-psa/shared/services/email/inboundEmailRecovery');

    const ingress = await upsertIngress(db, {
      tenant: tenantId,
      provider_id: providerId,
      provider_type: 'microsoft',
      ingress_key: `stuck:${randomUUID()}`,
      provider_pointer: { messageId: 'stuck-msg' },
    });

    // Worker claims the ingress row, then crashes before staging completes.
    const claim = await claimIngress(db, { tenant: tenantId, ingress_id: ingress.ingress_id, owner: 'crashed', leaseTtlMs: 30_000 });
    expect(claim.claimed).toBe(true);
    await tenantTable('inbound_email_ingress')
      .where({ ingress_id: ingress.ingress_id })
      .update({ lease_expires_at: db.raw("now() - interval '5 minutes'") });

    // The sweeper's due scan sees the expired `staging` row (not stranded).
    const due = await findDueIngress(db, { tenant: tenantId, limit: 10 });
    expect(due.some((row: any) => row.ingress_id === ingress.ingress_id && row.status === 'staging')).toBe(true);

    v2EnqueueMock.mockClear();
    const sweep = await sweepTenantDurableWork(tenantId, 10);
    expect(sweep.enqueued.ingress).toBeGreaterThanOrEqual(1);
    expect(v2EnqueueMock).toHaveBeenCalledWith(expect.objectContaining({ workType: 'stage_ingress', tenantId, recordId: ingress.ingress_id }));

    // A new worker atomically reclaims the expired staging lease (new token),
    // fencing the crashed worker out, and can continue staging.
    const reclaim = await reclaimIngress(db, { tenant: tenantId, ingress_id: ingress.ingress_id, owner: 'resumed', leaseTtlMs: 30_000 });
    expect(reclaim.claimed).toBe(true);
    expect(String(reclaim.row.lease_token)).not.toBe(String(claim.row.lease_token));
    const staleWrite = await transitionIngress(db, {
      tenant: tenantId,
      ingress_id: ingress.ingress_id,
      owner: 'crashed',
      token: String(claim.row.lease_token),
      version: Number(claim.row.lease_version),
      status: 'terminal_failed',
      error: 'zombie ingress write must not land',
    });
    expect(staleWrite).toBe(false);
  });

  it('legacy stuck-processing with a usable pointer becomes retryable via durable ingress work', async () => {
    const { providerId } = await setupProvider({ mailbox: 'legacy-pointer@example.com', providerType: 'google' });
    const messageId = `legacy-ptr-${randomUUID()}@example.com`;
    const legacyMessageId = `google:${messageId}`;

    await tenantTable('email_processed_messages').insert({
      message_id: legacyMessageId,
      provider_id: providerId,
      tenant: tenantId,
      processed_at: new Date(Date.now() - 60_000),
      processing_status: 'processing',
      from_email: 'sender@example.com',
      subject: 'Legacy pointer',
      received_at: db.fn.now(),
      metadata: JSON.stringify({
        queueJobId: 'legacy-job',
        queueProvider: 'google',
        pointer: { historyId: '5', pubsubMessageId: 'pub-5', emailAddress: 'legacy-pointer@example.com' },
        headersSnapshot: { messageId },
      }),
    });

    v2EnqueueMock.mockClear();
    const { backfillTenantLegacyRows } = await import('@alga-psa/shared/services/email/inboundEmailRecovery');
    const result = await backfillTenantLegacyRows(tenantId, 50);
    expect(result.imported).toBeGreaterThanOrEqual(1);

    // Durable ingress work was created so the source can be staged, and no
    // terminal inbox row was written (the legacy row stays the checkpoint).
    const ingress = await tenantTable('inbound_email_ingress').where({ tenant: tenantId }).first();
    expect(ingress).toBeTruthy();
    expect(ingress.status).toBe('received');
    expect(v2EnqueueMock).toHaveBeenCalledWith(expect.objectContaining({ workType: 'stage_ingress', tenantId, recordId: ingress.ingress_id }));
    expect(await countRows('inbound_email_inbox')).toBe(0);
  });

  it('a crashed outbox claim (expired publishing) is reclaimed by the dispatcher and publishes exactly once', async () => {
    const { providerId } = await setupProvider({ mailbox: 'outbox-reclaim@example.com', providerType: 'google' });
    const messageId = `outbox-reclaim-${randomUUID()}@example.com`;
    const rawMime = buildMime({ from: 's@example.com', to: 'outbox-reclaim@example.com', subject: 'Outbox reclaim', messageId, text: 'x' });
    const { inboxId } = await stageAndUpsertInbox({ providerId, providerType: 'google', rawMime, messageId });
    const created = await processInbox(inboxId, 'outbox-reclaim-worker');
    expect(created.outcome).toBe('created');
    createdTicketIds.push(created.ticketId);

    const outboxRow = await tenantTable('inbound_email_outbox').where({ inbox_id: inboxId }).orderBy('event_key', 'asc').first();
    const outboxId = String(outboxRow.outbox_id);

    // A dispatcher claims the row then "crashes" before marking published.
    const { claimOutboxRow, findDueOutbox, reclaimOutboxRow } = await import('@alga-psa/shared/services/email/inboundEmailDurableStore');
    const { processInboundOutboxJob } = await import('@alga-psa/shared/services/email/inboundEmailOutboxDispatcher');
    const { sweepTenantDurableWork } = await import('@alga-psa/shared/services/email/inboundEmailRecovery');

    const crashedClaim = await claimOutboxRow(db, { tenant: tenantId, outbox_id: outboxId, owner: 'crashed-dispatcher', leaseTtlMs: 30_000 });
    expect(crashedClaim.claimed).toBe(true);
    await tenantTable('inbound_email_outbox')
      .where({ outbox_id: outboxId })
      .update({ lease_expires_at: db.raw("now() - interval '5 minutes'") });

    // The sweeper's due scan sees the expired `publishing` row (not stranded).
    const due = await findDueOutbox(db, { tenant: tenantId, limit: 10 });
    expect(due.some((row: any) => row.outbox_id === outboxId && row.status === 'publishing')).toBe(true);

    v2EnqueueMock.mockClear();
    publishEventMock.mockClear();
    const sweep = await sweepTenantDurableWork(tenantId, 10);
    expect(sweep.enqueued.outbox).toBeGreaterThanOrEqual(1);
    expect(v2EnqueueMock).toHaveBeenCalledWith(expect.objectContaining({ workType: 'publish_outbox', tenantId, recordId: outboxId }));

    // A new dispatcher atomically reclaims the expired publishing lease (new
    // token) and publishes the SAME stable outbox id exactly once.
    const job: any = { schemaVersion: 2, workType: 'publish_outbox', tenantId, recordId: outboxId, inboxId, jobId: `ob-${randomUUID()}`, enqueuedAt: new Date().toISOString(), attempt: 0, maxAttempts: 5 };
    const result = await processInboundOutboxJob(job, { signal: new AbortController().signal, renew: async () => true, registerPostgresLease: () => undefined });
    expect(result.disposition).toBe('ack');

    expect(publishEventMock).toHaveBeenCalledTimes(1);
    const publishArgs = publishEventMock.mock.calls[0];
    expect((publishArgs as any)[1]).toMatchObject({ eventId: outboxId, strict: true });

    const terminal = await tenantTable('inbound_email_outbox').where({ outbox_id: outboxId }).first();
    expect(terminal.status).toBe('published');
    expect(terminal.published_at).toBeTruthy();
    expect(terminal.lease_token).toBeNull();

    // Redelivery reads the terminal row and ACKs without re-publishing.
    const again = await processInboundOutboxJob({ ...job, jobId: `ob2-${randomUUID()}` }, { signal: new AbortController().signal, renew: async () => true, registerPostgresLease: () => undefined });
    expect(again.disposition).toBe('ack');
    expect(publishEventMock).toHaveBeenCalledTimes(1);

    // The crashed dispatcher's stale token cannot terminal-write after reclaim.
    const staleWrite = await (await import('@alga-psa/shared/services/email/inboundEmailDurableStore')).transitionOutboxRow(db, {
      tenant: tenantId,
      outbox_id: outboxId,
      owner: 'crashed-dispatcher',
      token: String(crashedClaim.row.lease_token),
      version: Number(crashedClaim.row.lease_version),
      status: 'terminal_failed',
      error: 'zombie outbox write must not land',
    });
    expect(staleWrite).toBe(false);

    // reclaimOutboxRow on an already-published row is terminal.
    const reclaim = await reclaimOutboxRow(db, { tenant: tenantId, outbox_id: outboxId, owner: 'late', leaseTtlMs: 30_000 });
    expect(reclaim.claimed).toBe(false);
    expect(reclaim.reason).toBe('terminal');
  });

  it('a crashed artifact claim (expired processing) is reclaimed by the sweeper and completes exactly once', async () => {
    const { providerId } = await setupProvider({ mailbox: 'artifact-reclaim@example.com', providerType: 'google' });
    const messageId = `artifact-reclaim-${randomUUID()}@example.com`;
    const rawMime = buildMime({ from: 's@example.com', to: 'artifact-reclaim@example.com', subject: 'Artifact reclaim', messageId, text: 'x' });
    const { inboxId } = await stageAndUpsertInbox({ providerId, providerType: 'google', rawMime, messageId });
    const created = await processInbox(inboxId, 'artifact-reclaim-worker');
    expect(created.outcome).toBe('created');
    createdTicketIds.push(created.ticketId);

    // Every inbox creates an `original_email` artifact manifest row.
    const artifact = await tenantTable('inbound_email_artifacts').where({ inbox_id: inboxId }).first();
    expect(artifact).toBeTruthy();
    const artifactKey = String(artifact.artifact_key);

    // A worker claims the artifact then "crashes" before the terminal write.
    const { claimArtifact, findDueArtifacts, reclaimArtifact, transitionArtifact } = await import('@alga-psa/shared/services/email/inboundEmailDurableStore');
    const { processInboundArtifactJob } = await import('@alga-psa/shared/services/email/inboundEmailArtifactWorker');
    const { sweepTenantDurableWork } = await import('@alga-psa/shared/services/email/inboundEmailRecovery');

    const crashedClaim = await claimArtifact(db, { tenant: tenantId, inbox_id: inboxId, artifact_key: artifactKey, owner: 'crashed-artifact', leaseTtlMs: 30_000 });
    expect(crashedClaim.claimed).toBe(true);
    await tenantTable('inbound_email_artifacts')
      .where({ inbox_id: inboxId, artifact_key: artifactKey })
      .update({ lease_expires_at: db.raw("now() - interval '5 minutes'") });

    // The sweeper's due scan sees the expired `processing` row (not stranded).
    const due = await findDueArtifacts(db, { tenant: tenantId, limit: 10 });
    expect(due.some((row: any) => row.inbox_id === inboxId && row.artifact_key === artifactKey && row.status === 'processing')).toBe(true);

    v2EnqueueMock.mockClear();
    const sweep = await sweepTenantDurableWork(tenantId, 10);
    expect(sweep.enqueued.artifact).toBeGreaterThanOrEqual(1);
    expect(v2EnqueueMock).toHaveBeenCalledWith(expect.objectContaining({ workType: 'process_artifact', tenantId, recordId: artifactKey, inboxId }));

    // Guarantee the artifact completes: pre-seed the legacy compatibility
    // mirror with a success outcome for this original-email artifact. The
    // worker reclaims the expired lease (new token) and transitions to
    // `succeeded` exactly once regardless of the best-effort outcome.
    const { ORIGINAL_EMAIL_ATTACHMENT_ID } = await import('@alga-psa/shared/services/email/inboundEmailArtifactHelpers');
    await tenantTable('email_processed_attachments').insert({
      tenant: tenantId,
      provider_id: providerId,
      email_id: messageId,
      attachment_id: ORIGINAL_EMAIL_ATTACHMENT_ID,
      processing_status: 'success',
      file_id: randomUUID(),
      document_id: randomUUID(),
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    const job: any = { schemaVersion: 2, workType: 'process_artifact', tenantId, recordId: artifactKey, inboxId, jobId: `art-${randomUUID()}`, enqueuedAt: new Date().toISOString(), attempt: 0, maxAttempts: 5 };
    const result = await processInboundArtifactJob(job, { signal: new AbortController().signal, renew: async () => true, registerPostgresLease: () => undefined });
    expect(result.disposition).toBe('ack');

    const terminal = await tenantTable('inbound_email_artifacts').where({ inbox_id: inboxId, artifact_key: artifactKey }).first();
    expect(terminal.status).toBe('succeeded');
    expect(terminal.lease_token).toBeNull();
    expect(terminal.completed_at).toBeTruthy();
    expect(Number(await countRows('inbound_email_artifacts', { inbox_id: inboxId, artifact_key: artifactKey }))).toBe(1);

    // Redelivery reads the terminal row and ACKs without a second effect.
    const again = await processInboundArtifactJob({ ...job, jobId: `art2-${randomUUID()}` }, { signal: new AbortController().signal, renew: async () => true, registerPostgresLease: () => undefined });
    expect(again.disposition).toBe('ack');

    // The crashed worker's stale token cannot terminal-write after reclaim.
    const staleWrite = await transitionArtifact(db, {
      tenant: tenantId,
      inbox_id: inboxId,
      artifact_key: artifactKey,
      owner: 'crashed-artifact',
      token: String(crashedClaim.row.lease_token),
      version: Number(crashedClaim.row.lease_version),
      status: 'terminal_failed',
      error: 'zombie artifact write must not land',
    });
    expect(staleWrite).toBe(false);

    // reclaimArtifact on an already-succeeded row is terminal.
    const reclaim = await reclaimArtifact(db, { tenant: tenantId, inbox_id: inboxId, artifact_key: artifactKey, owner: 'late', leaseTtlMs: 30_000 });
    expect(reclaim.claimed).toBe(false);
    expect(reclaim.reason).toBe('terminal');
  });

  it('an over-cap expired outbox row dead-letters to terminal_failed instead of looping', async () => {
    const { providerId } = await setupProvider({ mailbox: 'outbox-dlq@example.com', providerType: 'google' });
    const messageId = `outbox-dlq-${randomUUID()}@example.com`;
    const rawMime = buildMime({ from: 's@example.com', to: 'outbox-dlq@example.com', subject: 'Outbox DLQ', messageId, text: 'x' });
    const { inboxId } = await stageAndUpsertInbox({ providerId, providerType: 'google', rawMime, messageId });
    const created = await processInbox(inboxId, 'outbox-dlq-worker');
    expect(created.outcome).toBe('created');
    createdTicketIds.push(created.ticketId);

    process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_MAX_ATTEMPTS = '3';
    cleanup.push(async () => {
      delete process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_MAX_ATTEMPTS;
    });

    const outboxRow = await tenantTable('inbound_email_outbox').where({ inbox_id: inboxId }).orderBy('event_key', 'asc').first();
    const outboxId = String(outboxRow.outbox_id);

    const { claimOutboxRow } = await import('@alga-psa/shared/services/email/inboundEmailDurableStore');
    const { processInboundOutboxJob } = await import('@alga-psa/shared/services/email/inboundEmailOutboxDispatcher');

    // Crash a worker that already exhausted its attempt budget (claim + set
    // over-cap + expire lease), then republish fails: it must dead-letter, not
    // loop.
    const crashedClaim = await claimOutboxRow(db, { tenant: tenantId, outbox_id: outboxId, owner: 'dlq-dispatcher', leaseTtlMs: 30_000 });
    expect(crashedClaim.claimed).toBe(true);
    await tenantTable('inbound_email_outbox')
      .where({ outbox_id: outboxId })
      .update({ attempt_count: 3, lease_expires_at: db.raw("now() - interval '5 minutes'") });

    publishEventMock.mockRejectedValue(new Error('event_bus_unavailable'));
    const job: any = { schemaVersion: 2, workType: 'publish_outbox', tenantId, recordId: outboxId, inboxId, jobId: `obdlq-${randomUUID()}`, enqueuedAt: new Date().toISOString(), attempt: 0, maxAttempts: 3 };
    const result = await processInboundOutboxJob(job, { signal: new AbortController().signal, renew: async () => true, registerPostgresLease: () => undefined });
    expect(result.disposition).toBe('ack');
    expect(result.outcome).toBe('terminal_failed');

    const terminal = await tenantTable('inbound_email_outbox').where({ outbox_id: outboxId }).first();
    expect(terminal.status).toBe('terminal_failed');
    expect(terminal.last_error).toBe('event_bus_unavailable');
    expect(terminal.lease_token).toBeNull();

    // Repeated delivery ACKs the stored terminal failure; nothing loops.
    const again = await processInboundOutboxJob({ ...job, jobId: `obdlq2-${randomUUID()}` }, { signal: new AbortController().signal, renew: async () => true, registerPostgresLease: () => undefined });
    expect(again.disposition).toBe('ack');
    publishEventMock.mockReset();
    publishEventMock.mockResolvedValue(undefined);
  });

  it('an over-cap expired artifact row dead-letters to terminal_failed instead of looping', async () => {
    const { providerId } = await setupProvider({ mailbox: 'artifact-dlq@example.com', providerType: 'google' });
    const messageId = `artifact-dlq-${randomUUID()}@example.com`;
    const rawMime = buildMime({ from: 's@example.com', to: 'artifact-dlq@example.com', subject: 'Artifact DLQ', messageId, text: 'x' });
    const { inboxId } = await stageAndUpsertInbox({ providerId, providerType: 'google', rawMime, messageId });
    const created = await processInbox(inboxId, 'artifact-dlq-worker');
    expect(created.outcome).toBe('created');
    createdTicketIds.push(created.ticketId);

    process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_MAX_ATTEMPTS = '3';
    cleanup.push(async () => {
      delete process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_MAX_ATTEMPTS;
    });

    const artifact = await tenantTable('inbound_email_artifacts').where({ inbox_id: inboxId }).first();
    expect(artifact).toBeTruthy();
    const artifactKey = String(artifact.artifact_key);

    const { claimArtifact } = await import('@alga-psa/shared/services/email/inboundEmailDurableStore');
    const { processInboundArtifactJob } = await import('@alga-psa/shared/services/email/inboundEmailArtifactWorker');

    // Crash a worker past its attempt budget; the source is gone so the
    // reclaimed attempt fails and the row must dead-letter, not loop.
    const crashedClaim = await claimArtifact(db, { tenant: tenantId, inbox_id: inboxId, artifact_key: artifactKey, owner: 'dlq-artifact', leaseTtlMs: 30_000 });
    expect(crashedClaim.claimed).toBe(true);
    await tenantTable('inbound_email_artifacts')
      .where({ inbox_id: inboxId, artifact_key: artifactKey })
      .update({ attempt_count: 3, lease_expires_at: db.raw("now() - interval '5 minutes'") });

    const inboxRow = await tenantTable('inbound_email_inbox').where({ inbox_id: inboxId }).first();
    storageObjects.delete(String(inboxRow.source_object_key));

    const job: any = { schemaVersion: 2, workType: 'process_artifact', tenantId, recordId: artifactKey, inboxId, jobId: `artdlq-${randomUUID()}`, enqueuedAt: new Date().toISOString(), attempt: 0, maxAttempts: 3 };
    const result = await processInboundArtifactJob(job, { signal: new AbortController().signal, renew: async () => true, registerPostgresLease: () => undefined });
    expect(result.disposition).toBe('ack');
    expect(result.outcome).toBe('terminal_failed');

    const terminal = await tenantTable('inbound_email_artifacts').where({ inbox_id: inboxId, artifact_key: artifactKey }).first();
    expect(terminal.status).toBe('terminal_failed');
    expect(terminal.lease_token).toBeNull();
    expect(terminal.completed_at).toBeTruthy();

    // Repeated delivery ACKs the stored terminal failure; nothing loops.
    const again = await processInboundArtifactJob({ ...job, jobId: `artdlq2-${randomUUID()}` }, { signal: new AbortController().signal, renew: async () => true, registerPostgresLease: () => undefined });
    expect(again.disposition).toBe('ack');
  });

  it('double-published outbox event is deduplicated by the DB delivery ledger (consumer idempotency)', async () => {
    const { providerId } = await setupProvider({ mailbox: 'idempotency@example.com', providerType: 'google' });
    const messageId = `idem-${randomUUID()}@example.com`;
    const rawMime = buildMime({ from: 's@example.com', to: 'idempotency@example.com', subject: 'Idempotency', messageId, text: 'x' });
    const { inboxId } = await stageAndUpsertInbox({ providerId, providerType: 'google', rawMime, messageId });
    const created = await processInbox(inboxId, 'idem-worker');
    expect(created.outcome).toBe('created');
    createdTicketIds.push(created.ticketId);

    const outboxRow = await tenantTable('inbound_email_outbox').where({ inbox_id: inboxId }).orderBy('event_key', 'asc').first();
    const outboxId = String(outboxRow.outbox_id);

    // Simulate crash-after-publish-before-mark: the first dispatcher claims the
    // row (publishing), crashes before marking `published`, its lease expires,
    // and a second dispatcher reclaims and re-publishes the SAME stable event
    // id (the durable outbox row id).
    const { claimOutboxRow } = await import('@alga-psa/shared/services/email/inboundEmailDurableStore');
    const { processInboundOutboxJob } = await import('@alga-psa/shared/services/email/inboundEmailOutboxDispatcher');
    const crashed = await claimOutboxRow(db, { tenant: tenantId, outbox_id: outboxId, owner: 'crashed-dispatcher', leaseTtlMs: 30_000 });
    expect(crashed.claimed).toBe(true);
    await tenantTable('inbound_email_outbox').where({ outbox_id: outboxId }).update({ lease_expires_at: db.raw("now() - interval '5 minutes'") });

    publishEventMock.mockClear();
    const job: any = { schemaVersion: 2, workType: 'publish_outbox', tenantId, recordId: outboxId, inboxId, jobId: `idem-${randomUUID()}`, enqueuedAt: new Date().toISOString(), attempt: 0, maxAttempts: 5 };
    const result = await processInboundOutboxJob(job, { signal: new AbortController().signal, renew: async () => true, registerPostgresLease: () => undefined });
    expect(result.disposition).toBe('ack');
    expect(publishEventMock).toHaveBeenCalledTimes(1);
    // The event id handed to consumers is the stable durable outbox id.
    expect(publishEventMock.mock.calls[0]?.[1]).toMatchObject({ eventId: outboxId, strict: true });

    // The consumer receives that event TWICE (Redis redelivery of the still-
    // pending stream entry after the crash window). The DB-enforced delivery
    // ledger makes the second delivery a no-op.
    const dbConn = await (await import('@alga-psa/db/admin')).getAdminConnection();
    const { dedupeInboundOutboxEventForConsumer } = await import('@alga-psa/shared/services/email/inboundEmailConsumerDedupe');
    const event = { id: outboxId, eventType: 'TICKET_CREATED', payload: { tenantId } };
    const firstDecision = await dedupeInboundOutboxEventForConsumer({ event, consumer: 'internal-notification', db: dbConn });
    expect(firstDecision).toBe('deliver');
    const secondDecision = await dedupeInboundOutboxEventForConsumer({ event, consumer: 'internal-notification', db: dbConn });
    expect(secondDecision).toBe('skip');

    // Exactly one ledger row per (tenant, outbox event, consumer).
    const ledgerCount = Number((await tenantTable('inbound_email_event_deliveries').where({ tenant: tenantId, outbox_id: outboxId, consumer: 'internal-notification' }).count<{ count: string }[]>('* as count').first())?.count);
    expect(ledgerCount).toBe(1);

    // A different consumer is independent: its own ledger row is claimable.
    const { claimInboundOutboxEventDelivery } = await import('@alga-psa/shared/services/email/inboundEmailDurableStore');
    const otherConsumer = await claimInboundOutboxEventDelivery(db, { tenant: tenantId, outbox_id: outboxId, consumer: 'ticket-email' });
    expect(otherConsumer.claimed).toBe(true);

    // The outbox row itself is `published` exactly once after the reclaim.
    const terminalOutbox = await tenantTable('inbound_email_outbox').where({ outbox_id: outboxId }).first();
    expect(terminalOutbox.status).toBe('published');
    expect(terminalOutbox.published_at).toBeTruthy();
  });

  it('legacy backfill is resumable: interrupted batches converge to the uninterrupted final state', async () => {
    const { providerId } = await setupProvider({ mailbox: 'backfill-resume@example.com', providerType: 'microsoft' });
    const { backfillTenantLegacyRows } = await import('@alga-psa/shared/services/email/inboundEmailRecovery');

    // Seed 6 legacy rows in a deterministic processed_at order, mixing the
    // incident shapes: 2 with reconcilable entities (processing), 1 skipped,
    // 1 unrecoverable processing, 2 failed/partial (terminal).
    const createdIds: Array<{ ticketId: string; messageKey: string }> = [];
    for (let i = 0; i < 2; i += 1) {
      const messageKey = `resume-${i}-${randomUUID()}@example.com`;
      const { createTicketFromEmail, createCommentFromEmail } = await import('@alga-psa/shared/workflow/actions/emailWorkflowActions');
      const { withAdminTransaction } = await import('@alga-psa/db');
      await withAdminTransaction(async (trx: any) => {
        const ticket = await createTicketFromEmail(
          {
            title: `Resume ${i}`,
            description: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'body', styles: {} }] }]),
            client_id: clientId,
            source: 'email',
            board_id: boardId,
            status_id: statusId,
            priority_id: priorityId,
            email_metadata: { messageId: messageKey, providerId },
          },
          tenantId,
          undefined,
          { existingConnection: trx }
        );
        await createCommentFromEmail(
          {
            ticket_id: ticket.ticket_id,
            content: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'body', styles: {} }] }]),
            source: 'email',
            suppressTechEmailNotification: true,
            metadata: { email: { messageId: messageKey } },
          },
          tenantId,
          undefined,
          { existingConnection: trx }
        );
        createdIds.push({ ticketId: String(ticket.ticket_id), messageKey });
      });
    }

    const legacyRows: Array<{
      key: string;
      status: string;
      processedAt: Date;
      metadata: Record<string, unknown>;
    }> = [];
    const processedAtBase = new Date(Date.now() - 60 * 60 * 1000);
    const pushLegacy = (key: string, status: string, index: number, metadata: Record<string, unknown>) => {
      legacyRows.push({ key, status, processedAt: new Date(processedAtBase.getTime() + index * 1000), metadata });
    };
    for (let i = 0; i < 2; i += 1) {
      const entity = createdIds[i];
      pushLegacy(`microsoft:${entity.messageKey}`, 'processing', i, {
        queueProvider: 'microsoft',
        headersSnapshot: { messageId: entity.messageKey },
      });
    }
    pushLegacy(`microsoft:skip-${randomUUID()}@example.com`, 'skipped', 2, { queueProvider: 'microsoft' });
    pushLegacy(`microsoft:unrec-${randomUUID()}@example.com`, 'processing', 3, { queueProvider: 'microsoft' });
    pushLegacy(`microsoft:fail1-${randomUUID()}@example.com`, 'failed', 4, { queueProvider: 'microsoft' });
    pushLegacy(`microsoft:fail2-${randomUUID()}@example.com`, 'partial', 5, { queueProvider: 'microsoft' });

    for (const row of legacyRows) {
      await tenantTable('email_processed_messages').insert({
        message_id: row.key,
        provider_id: providerId,
        tenant: tenantId,
        processed_at: row.processedAt,
        processing_status: row.status,
        from_email: 'sender@example.com',
        subject: 'Resume legacy',
        received_at: db.fn.now(),
        metadata: JSON.stringify(row.metadata),
      });
    }
    cleanup.push(async () => {
      for (const { ticketId } of createdIds) {
        try {
          await deleteTicketRows(ticketId);
        } catch {
          // best effort
        }
      }
    });

    // Interrupted run: only the first batch is processed (crash between
    // batches), then the backfill is re-run to completion.
    const firstRun = await backfillTenantLegacyRows(tenantId, 2);
    expect(firstRun.imported).toBeGreaterThanOrEqual(1);
    const afterInterrupt = await snapshotBackfillState(tenantId);

    const secondRun = await backfillTenantLegacyRows(tenantId, 50);
    expect(secondRun.imported).toBeGreaterThanOrEqual(3);
    const finalState = await snapshotBackfillState(tenantId);

    // The rows imported by the interrupted first batch are UNCHANGED in the
    // final state: the resume never re-did them with different results.
    const interruptedNormalized = new Set(afterInterrupt.inbox.map((r) => r.normalized));
    const finalInterruptedSubset = finalState.inbox.filter((r) => interruptedNormalized.has(r.normalized));
    expect(finalInterruptedSubset).toEqual(afterInterrupt.inbox);
    const interruptedEffects = new Set(afterInterrupt.effects.map((e) => `${e.normalized}:${e.type}`));
    const finalInterruptedEffects = finalState.effects.filter((e) => interruptedEffects.has(`${e.normalized}:${e.type}`));
    expect(finalInterruptedEffects).toEqual(afterInterrupt.effects);

    // The full run classifies every legacy row exactly once.
    const inboxRows = await tenantTable('inbound_email_inbox').where({ tenant: tenantId }).count<{ count: string }[]>('* as count').first();
    expect(Number(inboxRows?.count)).toBe(6);
    const effectRows = await tenantTable('inbound_email_effects').where({ tenant: tenantId }).count<{ count: string }[]>('* as count').first();
    expect(Number(effectRows?.count)).toBe(4);

    // No identity appears more than once.
    const perKey = new Map<string, number>();
    const allInbox = await tenantTable('inbound_email_inbox').where({ tenant: tenantId });
    for (const inbox of allInbox) {
      const key = `${inbox.provider_id}:${inbox.normalized_message_id}`;
      perKey.set(key, (perKey.get(key) ?? 0) + 1);
    }
    expect([...perKey.values()].every((count) => count === 1)).toBe(true);

    // A third run is a pure no-op: the backfill has converged.
    const thirdRun = await backfillTenantLegacyRows(tenantId, 50);
    expect(thirdRun.imported).toBe(0);
    expect(Number((await tenantTable('inbound_email_inbox').where({ tenant: tenantId }).count<{ count: string }[]>('* as count').first())?.count)).toBe(6);

    // Legacy audit rows were never modified or deleted.
    for (const row of legacyRows) {
      const legacy = await tenantTable('email_processed_messages').where({ message_id: row.key }).first();
      expect(legacy.processing_status).toBe(row.status);
    }
  });

  it('microsoft maintenance reconcile never advances its cursor past an unstaged message; retry recovers it', async () => {
    const { providerId } = await setupProvider({ mailbox: 'ms-cursor@example.com', providerType: 'microsoft' });
    const { EmailWebhookMaintenanceService } = await import('@alga-psa/shared/services/email/EmailWebhookMaintenanceService');
    const { processIngressStageJob } = await import('@alga-psa/shared/services/email/inboundEmailIngressStagingWorker');

    // Polling provider whose reconciliation window starts in the past.
    const oldCursor = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await tenantTable('microsoft_email_provider_config').where({ email_provider_id: providerId }).update({
      delivery_mode: 'polling',
      last_reconciliation_at: oldCursor,
    });

    const receivedT1 = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const receivedT2 = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    microsoftGraphAdapterMock.listMessagesReceivedSince.mockResolvedValue([
      { id: 'ms-cursor-1', receivedDateTime: receivedT1 },
      { id: 'ms-cursor-2', receivedDateTime: receivedT2 },
    ]);

    const service: any = new EmailWebhookMaintenanceService();
    const config: any = {
      id: providerId,
      tenant: tenantId,
      provider_type: 'microsoft',
      mailbox: 'ms-cursor@example.com',
      delivery_mode: 'polling',
      webhook_subscription_id: null,
      webhook_notification_url: 'https://example.com/api/email/webhooks/microsoft',
      provider_config: { max_emails_per_sync: 50 },
    };
    const adapter = new (await import('@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter')).MicrosoftGraphAdapter(config);
    v2EnqueueMock.mockClear();

    // Reconcile in enforce mode persists durable ingress but must NOT advance
    // the cursor: no message's source is staged yet.
    const reconcile = await service.reconcileMissedMessages(adapter, config, false);
    expect(reconcile.queuedMessages).toBe(2);

    let cursor = await tenantTable('microsoft_email_provider_config').where({ email_provider_id: providerId }).first();
    expect(new Date(cursor.last_reconciliation_at).getTime()).toBe(new Date(oldCursor).getTime());

    const ingresses = await tenantTable('inbound_email_ingress').where({ tenant: tenantId }).orderBy('ingress_key', 'asc');
    expect(ingresses.length).toBe(2);
    expect(v2EnqueueMock).toHaveBeenCalledWith(expect.objectContaining({ workType: 'stage_ingress', tenantId }));
    const firstIngress = ingresses.find((r: any) => r.provider_pointer.resource === 'maintenance-reconcile');
    expect(firstIngress).toBeTruthy();

    // Fail durable staging for the FIRST message: cursor stays untouched and
    // the ingress becomes retryable (message still recoverable).
    const failingJob: any = {
      schemaVersion: 2,
      workType: 'stage_ingress',
      tenantId,
      recordId: String(ingresses[0].ingress_id),
      jobId: `msstage-fail-${randomUUID()}`,
      enqueuedAt: new Date().toISOString(),
      attempt: 0,
      maxAttempts: 5,
    };
    microsoftFetchMock.mockRejectedValueOnce(new Error('provider_unavailable_temporarily'));
    const failResult = await processIngressStageJob(failingJob, { signal: new AbortController().signal, renew: async () => true, registerPostgresLease: () => undefined });
    expect(failResult.disposition).toBe('retry');

    cursor = await tenantTable('microsoft_email_provider_config').where({ email_provider_id: providerId }).first();
    expect(new Date(cursor.last_reconciliation_at).getTime()).toBe(new Date(oldCursor).getTime());
    const failedIngress = await tenantTable('inbound_email_ingress').where({ ingress_id: ingresses[0].ingress_id }).first();
    expect(failedIngress.status).toBe('retryable_failed');

    // Re-run reconcile: the failed message is re-listed (its source is not
    // staged) and re-ingressed idempotently; the cursor still does not advance.
    const rerun = await service.reconcileMissedMessages(adapter, config, false);
    expect(rerun.queuedMessages).toBeGreaterThanOrEqual(1);
    cursor = await tenantTable('microsoft_email_provider_config').where({ email_provider_id: providerId }).first();
    expect(new Date(cursor.last_reconciliation_at).getTime()).toBe(new Date(oldCursor).getTime());

    // Retry staging succeeds: the cursor advances to the staged message's
    // received time (durable source before cursor). First make the retryable
    // ingress due (its failure wrote a future backoff).
    await tenantTable('inbound_email_ingress')
      .where({ ingress_id: ingresses[0].ingress_id })
      .update({ next_attempt_at: db.raw("now() - interval '1 minute'") });
    microsoftFetchMock.mockResolvedValueOnce({
      id: 'ms-cursor-1',
      rawMime: 'From: Sender <s@example.com>\r\nTo: Support <ms-cursor@example.com>\r\nSubject: R1\r\nMessage-ID: <ms-cursor-1@example.com>\r\n\r\nbody\r\n',
    });
    const retryJob: any = { ...failingJob, jobId: `msstage-retry-${randomUUID()}` };
    const retryResult = await processIngressStageJob(retryJob, { signal: new AbortController().signal, renew: async () => true, registerPostgresLease: () => undefined });
    expect(retryResult.disposition).toBe('ack');
    const staged1 = await tenantTable('inbound_email_ingress').where({ ingress_id: ingresses[0].ingress_id }).first();
    expect(staged1.status).toBe('staged');

    cursor = await tenantTable('microsoft_email_provider_config').where({ email_provider_id: providerId }).first();
    expect(new Date(cursor.last_reconciliation_at).getTime()).toBe(new Date(receivedT1).getTime());

    // Stage the second message: the cursor advances monotonically to T2.
    const secondJob: any = {
      schemaVersion: 2,
      workType: 'stage_ingress',
      tenantId,
      recordId: String(ingresses[1].ingress_id),
      jobId: `msstage-2-${randomUUID()}`,
      enqueuedAt: new Date().toISOString(),
      attempt: 0,
      maxAttempts: 5,
    };
    microsoftFetchMock.mockResolvedValueOnce({
      id: 'ms-cursor-2',
      rawMime: 'From: Sender <s@example.com>\r\nTo: Support <ms-cursor@example.com>\r\nSubject: R2\r\nMessage-ID: <ms-cursor-2@example.com>\r\n\r\nbody\r\n',
    });
    const secondResult = await processIngressStageJob(secondJob, { signal: new AbortController().signal, renew: async () => true, registerPostgresLease: () => undefined });
    expect(secondResult.disposition).toBe('ack');
    cursor = await tenantTable('microsoft_email_provider_config').where({ email_provider_id: providerId }).first();
    expect(new Date(cursor.last_reconciliation_at).getTime()).toBe(new Date(receivedT2).getTime());
  });
});

async function snapshotBackfillState(tenant: string): Promise<{
  inbox: Array<{ normalized: string; status: string; outcome: string | null; reason: string | null; ticket: string | null; comment: string | null }>;
  effects: Array<{ normalized: string; type: string; entity: string; ticket: string }>;
}> {
  const inboxRows = await tenantDb(db, tenant).table('inbound_email_inbox').where({ tenant }).orderBy('normalized_message_id', 'asc');
  const effectRows = await tenantDb(db, tenant).table('inbound_email_effects').where({ tenant }).orderBy('normalized_message_id', 'asc');
  return {
    inbox: inboxRows.map((r: any) => ({ normalized: r.normalized_message_id, status: r.status, outcome: r.outcome_kind, reason: r.outcome_reason, ticket: r.ticket_id, comment: r.comment_id })),
    effects: effectRows.map((r: any) => ({ normalized: r.normalized_message_id, type: r.effect_type, entity: r.entity_id, ticket: r.ticket_id })),
  };
}
