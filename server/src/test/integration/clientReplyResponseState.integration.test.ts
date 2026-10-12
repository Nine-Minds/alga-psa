/**
 * Card 378dfcbb — portal and email client replies emit `ticket.response_state_changed`.
 *
 * DB-backed. Run with the dev stack env:
 *   cd server && set -a && . ../.env.localtest && set +a && \
 *     npx vitest run src/test/integration/clientReplyResponseState.integration.test.ts --coverage.enabled=false
 *
 * Every path that moves tickets.response_state because of a comment goes
 * through applyCommentResponseState. These tests drive the real portal action,
 * the real durable inbound-email pipeline (outbox + dispatcher), the legacy
 * createCommentFromEmail path, REST and the MSP UI action, and assert on the
 * signed webhook deliveries that come out the other end. The in-process bus and
 * webhook sink come from test-utils/webhookSinkHarness.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { randomUUID, createHash } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { runWithTenant, tenantDb, withAdminTransaction } from '@alga-psa/db';
import { TokenBucketRateLimiter } from '@alga-psa/core/rateLimit';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';
import {
  createMockRedis,
  flushDeferredDeliveries,
  startStubServer,
  waitFor,
  type WebhookHarnessState,
} from '../../../test-utils/webhookSinkHarness';

const state = vi.hoisted(() => ({
  db: null as any,
  handlers: new Map<string, (event: unknown) => Promise<void>>(),
  published: [] as Array<{ eventType: string; payload: any }>,
  jobs: [] as any[],
  pending: [] as Array<Promise<void>>,
  deferredErrors: [] as unknown[],
  secrets: new Map<string, string>(),
})) as WebhookHarnessState;

const authState = vi.hoisted(() => ({
  user: null as any,
  tenant: null as string | null,
  liveUpdates: [] as any[],
}));

const storageObjects = vi.hoisted(() => new Map<string, Buffer>());

vi.mock('@alga-psa/core/secrets', async () =>
  (await import('../../../test-utils/webhookSinkHarness')).secretsMockFactory(state));
vi.mock('server/src/lib/utils/getSecret', () => ({
  getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
    (envVar && process.env[envVar]) || fallback || ''),
}));
vi.mock('@alga-psa/core/logger', () => {
  const stub = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { default: stub, logger: stub };
});
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('server/src/lib/analytics/posthog', () => ({ analytics: { capture: vi.fn() } }));

vi.mock('@alga-psa/event-bus/publishers', async () =>
  (await import('../../../test-utils/webhookSinkHarness')).publishersMockFactory(state));
vi.mock('@/lib/eventBus', async () =>
  (await import('../../../test-utils/webhookSinkHarness')).eventBusMockFactory(state));

// parseStagedMimeIntoEmailDetails drops message headers, so a staged reply never carries
// Authentication-Results and the sender-auth gate would discard every contact match.
// Stand in for a DKIM-aligned sender; this card does not test the gate itself.
vi.mock('@alga-psa/shared/lib/email/senderAuthVerification', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  allowsContactSenderAttribution: () => true,
}));

vi.mock('@/lib/webhooks/autoDisable', () => ({ maybeAutoDisable: vi.fn(async () => undefined) }));
vi.mock('@/lib/webhooks/WebhookDeliveryQueue', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    WebhookDeliveryQueue: {
      getInstance: () => ({ enqueue: async (job: any) => { state.jobs.push(job); } }),
    },
  };
});

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    getConnection: async () => state.db,
    createTenantKnex: async () => ({ knex: state.db, tenant: authState.tenant }),
  };
});
vi.mock('@/lib/db/db', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, getConnection: async () => state.db };
});
vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: vi.fn(async () => state.db),
  destroyAdminConnection: vi.fn(async () => {}),
}));

// Portal and MSP actions are withAuth-wrapped; inject the acting user per call.
vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/auth')>()),
  withAuth: (action: any) => (...args: any[]) => action(authState.user, { tenant: authState.tenant }, ...args),
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));

vi.mock('@alga-psa/tickets/lib/liveUpdates', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  publishTicketUpdate: vi.fn(async (update: any) => { authState.liveUpdates.push(update); }),
}));
vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getClientLogoUrl: vi.fn().mockResolvedValue(null),
  getContactAvatarUrl: vi.fn().mockResolvedValue(null),
  getUserAvatarUrl: vi.fn().mockResolvedValue(null),
}));

// Durable inbound pipeline: object storage and the reply acknowledgement model.
vi.mock('@alga-psa/storage/StorageProviderFactory', () => ({
  StorageProviderFactory: {
    createProvider: vi.fn(async () => ({
      exists: async (path: string) => storageObjects.has(path),
      upload: async (buffer: Buffer, path: string) => {
        storageObjects.set(path, Buffer.from(buffer));
        return { path, size: buffer.length, mime_type: 'message/rfc822' };
      },
      download: async (path: string) => {
        const buffer = storageObjects.get(path);
        if (!buffer) throw new Error(`object not found: ${path}`);
        return buffer;
      },
    })),
  },
  generateStoragePath: (_tenant: string, basePath: string, name: string) => `${basePath}/${Date.now()}-${name}`,
}));
vi.mock('@alga-psa/shared/services/email/inboundReplyAcknowledgementDecider', () => ({
  resolveInboundReplyAcknowledgementDecider: vi.fn(async () => ({
    decide: async () => ({
      decision: 'NOT_ACK', source: 'default', attempted: false, reason: 'test', model: null, rawOutput: null, error: null,
    }),
  })),
}));

import { TicketService } from '../../lib/api/services/TicketService';
import { WebhookService } from '../../lib/api/services/WebhookService';
import { registerWebhookSubscriber } from '../../lib/eventBus/subscribers/webhookSubscriber';
import { processWebhookDeliveryJob } from '../../lib/webhooks/processWebhookDeliveryJob';
import { verifyWebhookSignature, WEBHOOK_SIGNATURE_HEADER } from '../../lib/webhooks/sign';
import { clearTicketWebhookPayloadCache } from '../../lib/eventBus/subscribers/webhook/webhookTicketPayload';
import { addClientTicketComment } from '@alga-psa/client-portal/actions/client-portal-actions/client-tickets';
import { createComment as createMspComment } from '@alga-psa/tickets/actions/comment-actions/commentActions';
import { createCommentFromEmail } from '@alga-psa/shared/workflow/actions/emailWorkflowActions';
import { TicketModel } from '@alga-psa/shared/models/ticketModel';
import { WorkflowEventPublisher } from '@alga-psa/shared/workflow/adapters/workflowEventPublisher';

type TrackingMode = 'on' | 'column-off' | 'nested-off';

const paragraph = (text: string) => JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }]);

describe('portal and email client replies emit ticket.response_state_changed (378dfcbb)', () => {
  const HOOK_TIMEOUT = 180_000;
  let db: Knex;
  let tenantId: string;
  let clientId: string;
  let staffUserId: string;
  let contactId: string; // contact with a portal user
  let clientUserId: string;
  let bareContactId: string; // contact with no user: email replies carry no user id
  let bareContactEmail: string;
  let boardId: string;
  let openStatusId: string;
  let closedStatusId: string;
  let priorityId: string;
  let providerId: string;
  let service: TicketService;
  let stub: Awaited<ReturnType<typeof startStubServer>>;
  let webhookSecret: string;
  const originalAllowPrivate = process.env.WEBHOOK_SSRF_ALLOW_PRIVATE;

  const table = (name: string) => tenantDb(db, tenantId).table(name);
  const stateEvents = (ticketId?: string) =>
    state.published.filter(
      (e) => e.eventType === 'TICKET_RESPONSE_STATE_CHANGED' && (!ticketId || e.payload.ticketId === ticketId),
    );

  async function setTracking(mode: TrackingMode) {
    const column = mode === 'column-off' ? { responseStateTrackingEnabled: false } : mode === 'on' ? { responseStateTrackingEnabled: true } : {};
    const nested = mode === 'nested-off' ? { ticketing: { display: { responseStateTrackingEnabled: false } } } : {};
    await db('tenant_settings')
      .insert({
        tenant: tenantId,
        ticket_display_settings: JSON.stringify(column),
        settings: JSON.stringify(nested),
      })
      .onConflict('tenant')
      .merge({ ticket_display_settings: JSON.stringify(column), settings: JSON.stringify(nested) });
  }

  async function createTicket(responseState: string | null, overrides: Record<string, unknown> = {}) {
    const ticketId = uuidv4();
    await table('tickets').insert({
      tenant: tenantId,
      ticket_id: ticketId,
      ticket_number: `CR-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: 'Client reply ticket',
      client_id: clientId,
      board_id: boardId,
      status_id: openStatusId,
      priority_id: priorityId,
      response_state: responseState,
      entered_at: new Date(),
      updated_at: new Date(),
      ...overrides,
    });
    return ticketId;
  }

  const responseStateOf = async (ticketId: string) =>
    (await table('tickets').where({ ticket_id: ticketId }).first('response_state'))?.response_state ?? null;

  const stateJobs = (ticketId: string) =>
    state.jobs.filter((j) => j.eventType === 'ticket.response_state_changed' && j.payload?.ticket_id === ticketId);

  /** Wait for the (deferred) consumer, then assert exactly one signed delivery. */
  async function expectOneSignedDelivery(ticketId: string, previous: string | null, next: string | null) {
    await flushDeferredDeliveries(state);
    const job = await waitFor(() => stateJobs(ticketId)[0]);
    expect(stateJobs(ticketId)).toHaveLength(1);
    const before = stub.received.length;
    const result = await processWebhookDeliveryJob(job);
    expect(result.outcome).toBe('delivered');
    const hit = stub.received.slice(before).find((r) => r.body?.data?.ticket_id === ticketId)!;
    expect(hit).toBeTruthy();
    expect(hit.body).toMatchObject({
      event_type: 'ticket.response_state_changed',
      tenant_id: tenantId,
      data: { ticket_id: ticketId, previous_response_state: previous, new_response_state: next },
    });
    expect(verifyWebhookSignature(hit.headers[WEBHOOK_SIGNATURE_HEADER.toLowerCase()], hit.bodyRaw, webhookSecret)).toBe(true);
    return hit;
  }

  async function expectNoStateEvent(ticketId: string) {
    await flushDeferredDeliveries(state);
    expect(stateEvents(ticketId)).toHaveLength(0);
    expect(stateJobs(ticketId)).toHaveLength(0);
  }

  const portalUser = () => ({
    user_id: clientUserId, user_type: 'client', email: `casey.${contactId}@example.com`, tenant: tenantId,
  });

  async function portalReply(ticketId: string) {
    authState.user = portalUser();
    authState.tenant = tenantId;
    const result = await addClientTicketComment(ticketId, paragraph('portal reply'));
    expect(result).toBe(true);
  }

  // ---- durable + legacy email helpers -------------------------------------

  async function setupProvider(): Promise<string> {
    const defaultsId = uuidv4();
    const id = uuidv4();
    await table('inbound_ticket_defaults').insert({
      id: defaultsId,
      tenant: tenantId,
      short_name: `cr-${defaultsId.slice(0, 6)}`,
      display_name: `CR Defaults ${defaultsId.slice(0, 6)}`,
      description: 'Test defaults',
      board_id: boardId,
      status_id: openStatusId,
      priority_id: priorityId,
      client_id: clientId,
      entered_by: staffUserId,
      is_active: true,
      is_default: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await table('email_providers').insert({
      id,
      tenant: tenantId,
      provider_type: 'google',
      provider_name: `CR Provider ${id.slice(0, 6)}`,
      mailbox: `support-${id.slice(0, 6)}@example.com`,
      is_active: true,
      status: 'connected',
      inbound_ticket_defaults_id: defaultsId,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await table('google_email_provider_config').insert({
      email_provider_id: id,
      tenant: tenantId,
      client_id: 'client-id',
      client_secret: 'secret',
      project_id: 'project-id',
      pubsub_topic_name: 'topic',
      pubsub_subscription_name: `sub-${id.slice(0, 6)}`,
      access_token: 'token',
      refresh_token: 'refresh',
      history_id: '1',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    return id;
  }

  // LEVERAGE: pattern inbound-reply-fixture — stage/upsert/process-inbox helpers duplicate inboundEmailDurableInbox.integration.test.ts; extract a shared durable-inbox test-utils module.
  async function stageReply(ticketId: string, from: string) {
    const { stageInboundSourceMime } = await import('@alga-psa/shared/services/email/inboundEmailSourceStager');
    const { upsertInbox, upsertIngress } = await import('@alga-psa/shared/services/email/inboundEmailDurableStore');
    const { normalizeInboundMessageIdentity } = await import('@alga-psa/shared/services/email/inboundEmailIdentity');

    // Outbound sending log so the reply threads onto the ticket by Message-ID.
    const originalMessageId = `orig-${randomUUID()}@example.com`;
    await table('email_sending_logs').insert({
      tenant: tenantId,
      message_id: `<${originalMessageId}>`,
      provider_id: providerId,
      provider_type: 'google',
      from_address: 'support@example.com',
      to_addresses: JSON.stringify([{ email: from }]),
      status: 'sent',
      sent_at: db.fn.now(),
      entity_type: 'ticket',
      entity_id: ticketId,
      rfc_message_id: `<${originalMessageId}>`,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    const messageId = `reply-${randomUUID()}@example.com`;
    const rawMime = Buffer.from([
      `From: Sender <${from}>`,
      'To: Support <support@example.com>',
      'Subject: Re: Client reply ticket',
      `Message-ID: <${messageId}>`,
      `In-Reply-To: <${originalMessageId}>`,
      `References: <${originalMessageId}>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'thanks, any update?',
      '',
    ].join('\r\n'));
    const identity = normalizeInboundMessageIdentity({
      providerType: 'google', rfcMessageId: messageId, providerMessageId: messageId,
    })!;
    const ingress = await upsertIngress(db, {
      tenant: tenantId, provider_id: providerId, provider_type: 'google',
      ingress_key: `test:${messageId}`, provider_pointer: { messageId },
    });
    const staged = await stageInboundSourceMime({
      tenant: tenantId, providerId, providerType: 'google', normalizedMessageId: identity.normalized, rawMime,
    });
    const row = await upsertInbox(db, {
      tenant: tenantId,
      ingress_id: ingress.ingress_id,
      provider_id: providerId,
      provider_type: 'google',
      normalized_message_id: identity.normalized,
      provider_message_id: messageId,
      rfc_message_id: identity.rfcMessageId,
      source_object_key: staged.objectKey,
      source_sha256: createHash('sha256').update(rawMime).digest('hex'),
      source_size_bytes: staged.sizeBytes,
      source_staged_at: new Date(),
      envelope: { messageId },
    });
    return row.inbox_id as string;
  }

  async function processInbox(inboxId: string, owner = `owner-${randomUUID()}`) {
    const { processInboundInbox } = await import('@alga-psa/shared/services/email/inboundEmailCoreProcessor');
    return processInboundInbox({ tenantId, inboxId, owner, leaseTtlMs: 30_000, mode: 'enforce' } as any);
  }

  const outboxRows = (inboxId: string, eventKey: string) =>
    table('inbound_email_outbox').where({ inbox_id: inboxId, event_key: eventKey });

  async function dispatchOutboxRow(inboxId: string, outboxId: string) {
    const { processInboundOutboxJob } = await import('@alga-psa/shared/services/email/inboundEmailOutboxDispatcher');
    const result = await processInboundOutboxJob(
      {
        schemaVersion: 2, workType: 'publish_outbox', tenantId, recordId: outboxId, inboxId,
        jobId: `cr-${randomUUID()}`, enqueuedAt: new Date().toISOString(), attempt: 0, maxAttempts: 5,
      } as any,
      { signal: new AbortController().signal, renew: async () => true, registerPostgresLease: () => undefined },
    );
    expect(result.disposition).toBe('ack');
  }

  /** Legacy (non-durable) createCommentFromEmail: no execution options. */
  async function legacyEmailComment(
    ticketId: string,
    author: { author_type: 'contact' | 'internal'; author_id?: string; contact_id?: string },
  ) {
    return createCommentFromEmail(
      { ticket_id: ticketId, content: paragraph('email reply'), source: 'email', ...author },
      tenantId,
    );
  }

  beforeAll(async () => {
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    db = await createTestDbConnection();
    state.db = db;

    tenantId = await createTenant(db, 'CR State Tenant');
    clientId = await createClient(db, tenantId, 'CR Client');
    staffUserId = await createUser(db, tenantId, { first_name: 'Sam', last_name: 'Staff', user_type: 'internal' });

    contactId = uuidv4();
    await table('contacts').insert({
      tenant: tenantId, contact_name_id: contactId, full_name: 'Casey Contact',
      email: `casey.${contactId}@example.com`, client_id: clientId,
    });
    clientUserId = await createUser(db, tenantId, {
      first_name: 'Casey', last_name: 'Contact', user_type: 'client', contact_id: contactId,
      email: `casey.${contactId}@example.com`,
    });

    bareContactId = uuidv4();
    bareContactEmail = `bare.${bareContactId}@example.com`;
    await table('contacts').insert({
      tenant: tenantId, contact_name_id: bareContactId, full_name: 'Bare Contact',
      email: bareContactEmail, client_id: clientId,
    });

    boardId = uuidv4();
    await table('boards').insert({ tenant: tenantId, board_id: boardId, board_name: 'CR Board' });
    openStatusId = uuidv4();
    await table('statuses').insert({
      tenant: tenantId, board_id: boardId, status_id: openStatusId, name: 'Open', status_type: 'ticket', is_closed: false, order_number: 1,
    });
    closedStatusId = uuidv4();
    await table('statuses').insert({
      tenant: tenantId, board_id: boardId, status_id: closedStatusId, name: 'Closed', status_type: 'ticket', is_closed: true, order_number: 100,
    });
    priorityId = uuidv4();
    await table('priorities').insert({
      tenant: tenantId, priority_id: priorityId, priority_name: 'Normal', color: '#808080', order_number: 1, created_by: staffUserId,
    });
    providerId = await setupProvider();

    service = new TicketService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: tenantId });
    await registerWebhookSubscriber();

    process.env.WEBHOOK_SSRF_ALLOW_PRIVATE = 'true';
    TokenBucketRateLimiter.resetInstance();
    await TokenBucketRateLimiter.getInstance().initialize(
      async () => createMockRedis(),
      { 'webhook-out': async () => ({ maxTokens: 1000, refillRate: 1000 / 60 }) },
    );
    stub = await startStubServer();
    const created = await new WebhookService(undefined as any, undefined as any, undefined as any).createWebhook(
      {
        name: 'CR state hook', url: stub.url, method: 'POST',
        event_types: ['ticket.response_state_changed'],
        payload_format: 'json', content_type: 'application/json', verify_ssl: false,
      } as any,
      tenantId,
      staffUserId,
    );
    webhookSecret = created.data.signing_secret;
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await stub?.close();
    TokenBucketRateLimiter.resetInstance();
    await db?.destroy().catch(() => undefined);
    if (originalAllowPrivate === undefined) delete process.env.WEBHOOK_SSRF_ALLOW_PRIVATE;
    else process.env.WEBHOOK_SSRF_ALLOW_PRIVATE = originalAllowPrivate;
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    state.published.length = 0;
    state.jobs.length = 0;
    authState.liveUpdates.length = 0;
    clearTicketWebhookPayloadCache();
    await setTracking('on');
  });

  afterEach(async () => {
    await flushDeferredDeliveries(state);
  });

  // ---- 1-4: client portal ---------------------------------------------------

  it('1. portal reply on an awaiting_client ticket emits one signed awaiting_client -> awaiting_internal delivery', async () => {
    const ticketId = await createTicket('awaiting_client');
    await portalReply(ticketId);

    expect(await responseStateOf(ticketId)).toBe('awaiting_internal');
    await expectOneSignedDelivery(ticketId, 'awaiting_client', 'awaiting_internal');

    const events = stateEvents(ticketId);
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      tenantId, ticketId, userId: clientUserId, trigger: 'comment',
      previousResponseState: 'awaiting_client', newResponseState: 'awaiting_internal',
    });
    // The live update claims response_state because it really changed.
    expect(authState.liveUpdates.at(-1).updatedFields).toEqual(['comments', 'response_state']);
  });

  it('2. portal reply on an already awaiting_internal ticket emits no change event but still emits comment.added', async () => {
    const ticketId = await createTicket('awaiting_internal');
    await portalReply(ticketId);

    expect(await responseStateOf(ticketId)).toBe('awaiting_internal');
    await expectNoStateEvent(ticketId);
    expect(
      state.published.some((e) => e.eventType === 'TICKET_COMMENT_ADDED' && e.payload.ticketId === ticketId),
    ).toBe(true);
    // No state change, so the live update must not claim one.
    expect(authState.liveUpdates.at(-1).updatedFields).toEqual(['comments']);
  });

  it.each<[string, TrackingMode]>([
    ['the tenant_settings column', 'column-off'],
    ['the nested settings.ticketing.display path', 'nested-off'],
  ])('3. portal reply with tracking disabled via %s changes nothing and emits nothing', async (_label, mode) => {
    await setTracking(mode);
    const ticketId = await createTicket('awaiting_client');
    await portalReply(ticketId);

    expect(await responseStateOf(ticketId)).toBe('awaiting_client');
    await expectNoStateEvent(ticketId);
    expect(authState.liveUpdates.at(-1).updatedFields).toEqual(['comments']);
  });

  it.each<[string, TrackingMode]>([
    ['enabled', 'on'],
    ['disabled', 'column-off'],
  ])('4. portal reply on a bundle child still reopens the closed master (tracking %s)', async (_label, mode) => {
    await setTracking(mode);
    const masterId = await createTicket(null, { status_id: closedStatusId });
    const childId = await createTicket('awaiting_client', { master_ticket_id: masterId });
    await table('ticket_bundle_settings').insert({
      tenant: tenantId, master_ticket_id: masterId, mode: 'sync_updates', reopen_on_child_reply: true,
    });

    await portalReply(childId);

    const master = await table('tickets').where({ ticket_id: masterId }).first('status_id');
    expect(master.status_id).toBe(openStatusId);
    expect(await responseStateOf(childId)).toBe(mode === 'on' ? 'awaiting_internal' : 'awaiting_client');
  });

  // ---- 5-8: email -------------------------------------------------------------

  it('5. durable email reply writes one response-state-changed outbox row, dispatches one signed delivery, and replay adds none', async () => {
    const ticketId = await createTicket('awaiting_client');
    const inboxId = await stageReply(ticketId, bareContactEmail);

    const result = await processInbox(inboxId);
    expect(result, JSON.stringify(result)).toMatchObject({ outcome: 'replied' });
    expect(await responseStateOf(ticketId)).toBe('awaiting_internal');

    // Written in the commit transaction, not published from a hook.
    const rows = await outboxRows(inboxId, 'response-state-changed');
    expect(rows).toHaveLength(1);
    expect(rows[0].event_type).toBe('TICKET_RESPONSE_STATE_CHANGED');
    expect(rows[0].payload).toMatchObject({
      tenantId, ticketId, userId: null, trigger: 'comment',
      previousResponseState: 'awaiting_client', newResponseState: 'awaiting_internal',
    });
    expect(stateEvents(ticketId)).toHaveLength(0);

    await dispatchOutboxRow(inboxId, String(rows[0].outbox_id));
    const hit = await expectOneSignedDelivery(ticketId, 'awaiting_client', 'awaiting_internal');
    expect(hit.body.data.ticket_id).toBe(ticketId);
    expect(stateEvents(ticketId)).toHaveLength(1);
    expect(stateEvents(ticketId)[0].payload.userId).toBeNull();

    // Replay of the same inbox message: no second comment, no second outbox row.
    const commentCount = Number((await table('comments').where({ ticket_id: ticketId }).count<{ count: string }[]>('* as count').first())?.count);
    const replay = await processInbox(inboxId, 'replay-worker');
    expect(replay.disposition).toBe('ack');
    expect(await outboxRows(inboxId, 'response-state-changed')).toHaveLength(1);
    expect(Number((await table('comments').where({ ticket_id: ticketId }).count<{ count: string }[]>('* as count').first())?.count)).toBe(commentCount);
  }, HOOK_TIMEOUT);

  it('6. legacy email reply publishes once after commit, and a rolled-back transaction emits nothing', async () => {
    const ticketId = await createTicket('awaiting_client');
    await legacyEmailComment(ticketId, { author_type: 'contact', contact_id: bareContactId });

    expect(await responseStateOf(ticketId)).toBe('awaiting_internal');
    const hit = await expectOneSignedDelivery(ticketId, 'awaiting_client', 'awaiting_internal');
    expect(hit.body.data.ticket_id).toBe(ticketId);
    expect(stateEvents(ticketId)[0].payload.userId).toBeNull();

    // Forced rollback: the model's after-commit hook must never fire.
    const rolledBack = await createTicket('awaiting_client');
    await expect(
      withAdminTransaction(async (trx: Knex.Transaction) => {
        await TicketModel.createComment(
          {
            ticket_id: rolledBack, content: paragraph('never committed'), is_internal: false, is_resolution: false,
            author_type: 'contact', contact_id: bareContactId,
          } as any,
          tenantId,
          trx,
          new WorkflowEventPublisher({ transaction: trx }) as any,
        );
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');
    expect(await responseStateOf(rolledBack)).toBe('awaiting_client');
    await expectNoStateEvent(rolledBack);
  }, HOOK_TIMEOUT);

  it.each<['durable' | 'legacy', string, TrackingMode, string]>([
    ['durable', 'already awaiting_internal', 'on', 'awaiting_internal'],
    ['legacy', 'already awaiting_internal', 'on', 'awaiting_internal'],
    ['durable', 'tracking disabled via the column', 'column-off', 'awaiting_client'],
    ['legacy', 'tracking disabled via the column', 'column-off', 'awaiting_client'],
    ['durable', 'tracking disabled via the nested path', 'nested-off', 'awaiting_client'],
    ['legacy', 'tracking disabled via the nested path', 'nested-off', 'awaiting_client'],
  ])('7. %s email reply with %s emits no change event', async (path, _label, mode, initial) => {
    await setTracking(mode);
    const ticketId = await createTicket(initial);
    if (path === 'durable') {
      const inboxId = await stageReply(ticketId, bareContactEmail);
      { const r = await processInbox(inboxId); expect(r, JSON.stringify(r)).toMatchObject({ outcome: 'replied' }); }
      expect(await outboxRows(inboxId, 'response-state-changed')).toHaveLength(0);
      // The reply comment event is still recorded.
      expect((await outboxRows(inboxId, 'reply-comment-created')).length).toBe(1);
    } else {
      await legacyEmailComment(ticketId, { author_type: 'contact', contact_id: bareContactId });
      // The legacy path records the comment.added publication intent on the comment row.
      const comment = await table('comments').where({ ticket_id: ticketId }).orderBy('created_at', 'desc').first();
      expect(comment?.scheduled_publish_event_id).toBeTruthy();
    }
    expect(await responseStateOf(ticketId)).toBe(initial);
    await expectNoStateEvent(ticketId);
  }, HOOK_TIMEOUT);

  it('8. a staff reply by email moves awaiting_internal -> awaiting_client and emits the event', async () => {
    const ticketId = await createTicket('awaiting_internal');
    await legacyEmailComment(ticketId, { author_type: 'internal', author_id: staffUserId });

    expect(await responseStateOf(ticketId)).toBe('awaiting_client');
    await expectOneSignedDelivery(ticketId, 'awaiting_internal', 'awaiting_client');
    expect(stateEvents(ticketId)[0].payload.userId).toBe(staffUserId);
  }, HOOK_TIMEOUT);

  // ---- 9: parity --------------------------------------------------------------

  it('9. the event payload and webhook body field sets match across portal, email, REST and UI', async () => {
    const { EventSchemas } = await import('@alga-psa/event-bus/schemas/eventBusSchema');
    const sources: Array<[string, (ticketId: string) => Promise<void>, string | null]> = [
      ['portal', (t) => portalReply(t), 'awaiting_client'],
      ['email', async (t) => { await legacyEmailComment(t, { author_type: 'contact', contact_id: bareContactId }); }, 'awaiting_client'],
      ['rest', async (t) => {
        await service.addComment(t, { comment_text: 'rest reply', is_internal: false } as any, { tenant: tenantId, userId: clientUserId } as any);
      }, 'awaiting_client'],
      ['ui', async (t) => {
        authState.user = { user_id: staffUserId, user_type: 'internal', tenant: tenantId };
        authState.tenant = tenantId;
        const id = await runWithTenant(tenantId, () => createMspComment({
          ticket_id: t, user_id: staffUserId, author_type: 'internal', note: paragraph('ui reply'),
          is_internal: false, is_resolution: false,
        } as any));
        expect(typeof id).toBe('string');
      }, 'awaiting_internal'],
    ];

    const eventKeys = new Map<string, string[]>();
    const bodyKeys = new Map<string, string[]>();
    for (const [name, act, initial] of sources) {
      const ticketId = await createTicket(initial);
      await act(ticketId);
      const hit = await expectOneSignedDelivery(
        ticketId,
        initial,
        initial === 'awaiting_client' ? 'awaiting_internal' : 'awaiting_client',
      );
      const raw = stateEvents(ticketId)[0].payload;
      // The payload must satisfy the consumer schema; key parity is checked on the raw payload.
      (EventSchemas as any).TICKET_RESPONSE_STATE_CHANGED.parse({
        id: uuidv4(), eventType: 'TICKET_RESPONSE_STATE_CHANGED', timestamp: new Date().toISOString(), payload: raw,
      });
      eventKeys.set(name, Object.keys(raw).sort());
      bodyKeys.set(name, Object.keys(hit.body.data).sort());
    }

    const [firstEvent, ...restEvents] = [...eventKeys.values()];
    for (const keys of restEvents) expect(keys).toEqual(firstEvent);
    const [firstBody, ...restBodies] = [...bodyKeys.values()];
    for (const keys of restBodies) expect(keys).toEqual(firstBody);
  }, HOOK_TIMEOUT);
});
