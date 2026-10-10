/**
 * Card c219d6bf — REST comments update response_state, richer ticket webhooks.
 *
 * DB-backed. Run with the dev stack env:
 *   cd server && set -a && . ../.env.localtest && set +a && \
 *     npx vitest run src/test/integration/restCommentResponseState.integration.test.ts --coverage.enabled=false
 *
 * Covers: shared response-state helper (REST + UI shape), tracking-disabled,
 * API close clearing the state, signed `ticket.response_state_changed` delivery
 * for a webhook created through the REST create path, contact/author fields on
 * `comment` and `comments[]`, and the `response_state` list filter.
 */
import http from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { TokenBucketRateLimiter } from '@alga-psa/core/rateLimit';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createClient, createTenant, createUser } from '../../../test-utils/testDataFactory';

const state = vi.hoisted(() => ({
  db: null as any,
  handlers: new Map<string, (event: unknown) => Promise<void>>(),
  published: [] as Array<{ eventType: string; payload: any }>,
  jobs: [] as any[],
  pending: [] as Array<Promise<void>>,
  deferredErrors: [] as unknown[],
  secrets: new Map<string, string>(),
}));

vi.mock('server/src/lib/utils/getSecret', () => ({
  getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
    (envVar && process.env[envVar]) || fallback || ''),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
    (envVar && process.env[envVar]) || fallback || ''),
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: async () => '',
    getTenantSecret: async (tenant: string, name: string) => state.secrets.get(`${tenant}/${name}`) ?? null,
    setTenantSecret: async (tenant: string, name: string, value: string) => {
      state.secrets.set(`${tenant}/${name}`, value);
    },
    deleteTenantSecret: async (tenant: string, name: string) => {
      state.secrets.delete(`${tenant}/${name}`);
    },
  })),
  secretProvider: {
    getSecret: vi.fn(async (_key: string, envVar?: string, fallback?: string) =>
      (envVar && process.env[envVar]) || fallback || ''),
  },
}));

vi.mock('@alga-psa/core/logger', () => {
  const stub = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { default: stub, logger: stub };
});

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('server/src/lib/analytics/posthog', () => ({ analytics: { capture: vi.fn() } }));

// The in-process "bus": publishEvent records the event and hands it to whatever
// the real webhook subscriber registered through getEventBus().subscribe.
// Like the real Redis consumer (packages/event-bus/src/eventBus.ts) it runs the
// event through EventSchemas[eventType].parse(...) first, so fields the schema
// does not declare are stripped exactly as in production.
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: vi.fn(async (event: { eventType: string; payload: any }) => {
    state.published.push({ eventType: event.eventType, payload: event.payload });
    const handler = state.handlers.get(event.eventType);
    if (handler) {
      const { EventSchemas } = await import('@alga-psa/event-bus/schemas/eventBusSchema');
      const schema = (EventSchemas as Record<string, { parse: (v: unknown) => unknown } | undefined>)[event.eventType];
      if (!schema) {
        throw new Error(`No EventSchemas entry for ${event.eventType}; refusing to skip the consumer parse`);
      }
      const parsed = schema.parse({
        id: uuidv4(),
        eventType: event.eventType,
        timestamp: new Date().toISOString(),
        payload: event.payload,
      }) as unknown;
      if (event.eventType === 'TICKET_RESPONSE_STATE_CHANGED') {
        // In production this event is consumed after the comment.added event of
        // the same transaction (separate stream messages, possibly other pods).
        // Deliver it late so the comment.added build cannot benefit from this
        // event's side effects.
        // Tracked in state.pending and flushed in afterEach so no delivery crosses
        // a test boundary; failures are recorded and rethrown there.
        state.pending.push(
          new Promise<void>((resolve) => {
            setTimeout(() => {
              handler(parsed)
                .catch((error) => { state.deferredErrors.push(error); })
                .finally(resolve);
            }, 250);
          }),
        );
      } else {
        await handler(parsed);
      }
    }
  }),
  publishWorkflowEvent: vi.fn(async () => {}),
}));

vi.mock('@/lib/eventBus', () => ({
  getEventBus: () => ({
    subscribe: async (eventType: string, handler: (event: unknown) => Promise<void>) => {
      state.handlers.set(eventType, handler);
    },
    unsubscribe: async (eventType: string) => {
      state.handlers.delete(eventType);
    },
    publish: vi.fn(async () => {}),
  }),
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, getConnection: async () => state.db };
});

vi.mock('@/lib/db/db', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, getConnection: async () => state.db };
});

vi.mock('@/lib/webhooks/autoDisable', () => ({ maybeAutoDisable: vi.fn(async () => undefined) }));

vi.mock('@/lib/webhooks/WebhookDeliveryQueue', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    WebhookDeliveryQueue: {
      getInstance: () => ({
        enqueue: async (job: any) => {
          state.jobs.push(job);
        },
      }),
    },
  };
});

import { TicketService } from '../../lib/api/services/TicketService';
import { WebhookService } from '../../lib/api/services/WebhookService';
import { registerWebhookSubscriber } from '../../lib/eventBus/subscribers/webhookSubscriber';
import { processWebhookDeliveryJob } from '../../lib/webhooks/processWebhookDeliveryJob';
import { verifyWebhookSignature, WEBHOOK_SIGNATURE_HEADER } from '../../lib/webhooks/sign';
import { webhookModel } from '../../lib/webhooks/webhookModel';
import {
  buildTicketWebhookPayload,
  clearTicketWebhookPayloadCache,
} from '../../lib/eventBus/subscribers/webhook/webhookTicketPayload';
import {
  applyCommentResponseState,
  resolveCommentAuthor,
} from '@alga-psa/shared/lib/tickets/responseState';

type Captured = { headers: Record<string, string>; bodyRaw: string; body: any };

function createMockRedis() {
  const kv = new Map<string, string>();
  return {
    async get(key: string) { return kv.get(key) ?? null; },
    async set(key: string, value: string) { kv.set(key, value); return 'OK'; },
    async del(key: string | string[]) {
      let n = 0;
      for (const k of Array.isArray(key) ? key : [key]) if (kv.delete(k)) n += 1;
      return n;
    },
    async zAdd() { return 1; },
    async zRem() { return 1; },
    async zRangeByScore() { return []; },
    async zCard() { return 0; },
  } as any;
}

async function startStubServer() {
  const received: Captured[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const bodyRaw = Buffer.concat(chunks).toString('utf8');
      received.push({ headers: req.headers as Record<string, string>, bodyRaw, body: JSON.parse(bodyRaw) });
      res.statusCode = 200;
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${address.port}`,
    received,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function waitFor<T>(fn: () => T | undefined | false, timeoutMs = 10_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = fn();
    if (value) return value as T;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('REST comments update response_state + richer ticket webhooks (c219d6bf)', () => {
  const HOOK_TIMEOUT = 180_000;
  let db: Knex;
  let tenantId: string;
  let clientId: string;
  let staffUserId: string;
  let contactId: string;
  let clientUserId: string;
  let boardId: string;
  let openStatusId: string;
  let closedStatusId: string;
  let priorityId: string;
  let service: TicketService;
  const originalAllowPrivate = process.env.WEBHOOK_SSRF_ALLOW_PRIVATE;

  const table = (name: string) => tenantDb(db, tenantId).table(name);
  const staffCtx = () => ({ tenant: tenantId, userId: staffUserId }) as any;
  const clientCtx = () => ({ tenant: tenantId, userId: clientUserId }) as any;

  async function setTracking(enabled: boolean) {
    await db('tenant_settings')
      .insert({
        tenant: tenantId,
        ticket_display_settings: JSON.stringify({ responseStateTrackingEnabled: enabled }),
      })
      .onConflict('tenant')
      .merge({ ticket_display_settings: JSON.stringify({ responseStateTrackingEnabled: enabled }) });
  }

  async function createTicket(responseState: string | null = null, statusId = openStatusId) {
    const ticketId = uuidv4();
    await table('tickets').insert({
      tenant: tenantId,
      ticket_id: ticketId,
      ticket_number: `RS-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: 'Response state ticket',
      client_id: clientId,
      board_id: boardId,
      status_id: statusId,
      priority_id: priorityId,
      response_state: responseState,
      entered_at: new Date(),
      updated_at: new Date(),
    });
    return ticketId;
  }

  let commentHookCreated = false;
  async function ensureCommentHook() {
    if (commentHookCreated) return;
    const webhookService = new WebhookService(undefined as any, undefined as any, undefined as any);
    process.env.WEBHOOK_SSRF_ALLOW_PRIVATE = 'true';
    await webhookService.createWebhook(
      {
        name: 'RS comment hook',
        url: 'http://127.0.0.1:9/unused',
        method: 'POST',
        event_types: ['ticket.comment.added'],
        payload_format: 'json',
        content_type: 'application/json',
        verify_ssl: false,
      } as any,
      tenantId,
      staffUserId,
    );
    commentHookCreated = true;
  }

  const commentJobFor = (ticketId: string) =>
    waitFor(() => state.jobs.find((j) => j.eventType === 'ticket.comment.added' && j.payload?.ticket_id === ticketId));

  async function responseStateOf(ticketId: string) {
    const row = await table('tickets').where({ ticket_id: ticketId }).first('response_state');
    return row?.response_state ?? null;
  }

  beforeAll(async () => {
    process.env.DB_HOST = process.env.DB_HOST || 'localhost';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    db = await createTestDbConnection();
    state.db = db;

    tenantId = await createTenant(db, 'RS REST Tenant');
    clientId = await createClient(db, tenantId, 'RS REST Client');
    staffUserId = await createUser(db, tenantId, { first_name: 'Sam', last_name: 'Staff', user_type: 'internal' });

    contactId = uuidv4();
    await table('contacts').insert({
      tenant: tenantId,
      contact_name_id: contactId,
      full_name: 'Casey Contact',
      email: `casey.${contactId}@example.com`,
      client_id: clientId,
    });
    clientUserId = await createUser(db, tenantId, {
      first_name: 'Casey',
      last_name: 'Contact',
      user_type: 'client',
      contact_id: contactId,
    });

    boardId = uuidv4();
    await table('boards').insert({ tenant: tenantId, board_id: boardId, board_name: 'RS Board' });
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

    service = new TicketService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: tenantId });
    await registerWebhookSubscriber();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
    if (originalAllowPrivate === undefined) delete process.env.WEBHOOK_SSRF_ALLOW_PRIVATE;
    else process.env.WEBHOOK_SSRF_ALLOW_PRIVATE = originalAllowPrivate;
  }, HOOK_TIMEOUT);

  async function flushDeferredDeliveries() {
    while (state.pending.length > 0) {
      await Promise.all(state.pending.splice(0));
    }
    if (state.deferredErrors.length > 0) {
      const errors = state.deferredErrors.splice(0);
      throw new Error(`Deferred event delivery failed: ${errors.map(String).join('; ')}`);
    }
  }

  afterEach(async () => {
    await flushDeferredDeliveries();
  });

  beforeEach(async () => {
    state.published.length = 0;
    state.jobs.length = 0;
    await setTracking(true);
  });

  const stateEvents = () => state.published.filter((e) => e.eventType === 'TICKET_RESPONSE_STATE_CHANGED');

  it('1. REST client-visible comment by an internal user sets author_type=internal and awaiting_client', async () => {
    await ensureCommentHook();
    const ticketId = await createTicket(null);
    const comment = await service.addComment(
      ticketId,
      { comment_text: 'We are on it', is_internal: false } as any,
      staffCtx(),
    );

    const row = await table('comments').where({ comment_id: comment.comment_id }).first();
    expect(row.author_type).toBe('internal');
    expect(await responseStateOf(ticketId)).toBe('awaiting_client');

    const events = stateEvents();
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      ticketId,
      previousResponseState: null,
      newResponseState: 'awaiting_client',
      trigger: 'comment',
    });

    // The delivered payload went through the consumer-side schema parse: the
    // top-level comment must still carry author fields.
    const job = await commentJobFor(ticketId);
    expect(job.payload.comment.author_type).toBe('internal');
  });

  it('2. REST internal note leaves response_state unchanged and emits nothing', async () => {
    const ticketId = await createTicket('awaiting_internal');
    await service.addComment(ticketId, { comment_text: 'private note', is_internal: true } as any, staffCtx());
    expect(await responseStateOf(ticketId)).toBe('awaiting_internal');
    expect(stateEvents()).toHaveLength(0);
  });

  it('3. tracking disabled: no state change and no event', async () => {
    await setTracking(false);
    const ticketId = await createTicket(null);
    await service.addComment(ticketId, { comment_text: 'hello', is_internal: false } as any, staffCtx());
    expect(await responseStateOf(ticketId)).toBeNull();
    expect(stateEvents()).toHaveLength(0);
  });

  it('REST comment from a client user records author_type=client + contact and sets awaiting_internal', async () => {
    await ensureCommentHook();
    const ticketId = await createTicket('awaiting_client');
    const comment = await service.addComment(ticketId, { comment_text: 'any update?', is_internal: false } as any, clientCtx());
    const row = await table('comments').where({ comment_id: comment.comment_id }).first();
    expect(row.author_type).toBe('client');
    expect(row.contact_id).toBe(contactId);
    expect(await responseStateOf(ticketId)).toBe('awaiting_internal');

    const job = await commentJobFor(ticketId);
    expect(job.payload.comment).toMatchObject({
      author_type: 'client',
      contact_id: contactId,
      contact_name: 'Casey Contact',
    });
    expect(job.payload.comments.find((c: any) => c.contact_name === 'Casey Contact'))
      .toMatchObject({ author_type: 'client', contact_id: contactId });
  });

  it('REST close clears response_state and emits a close-triggered change', async () => {
    const ticketId = await createTicket('awaiting_client');
    await service.update(ticketId, { status_id: closedStatusId } as any, staffCtx());
    expect(await responseStateOf(ticketId)).toBeNull();
    const events = stateEvents();
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      ticketId, previousResponseState: 'awaiting_client', newResponseState: null, trigger: 'close',
    });
  });

  it('4. delivers a signed ticket.response_state_changed webhook (webhook created via REST create path)', async () => {
    process.env.WEBHOOK_SSRF_ALLOW_PRIVATE = 'true';
    TokenBucketRateLimiter.resetInstance();
    await TokenBucketRateLimiter.getInstance().initialize(
      async () => createMockRedis(),
      { 'webhook-out': async () => ({ maxTokens: 100, refillRate: 100 / 60 }) },
    );
    const stub = await startStubServer();
    try {
      const webhookService = new WebhookService(undefined as any, undefined as any, undefined as any);
      const created = await webhookService.createWebhook(
        {
          name: 'RS hook',
          url: stub.url,
          method: 'POST',
          event_types: ['ticket.response_state_changed'],
          payload_format: 'json',
          content_type: 'application/json',
          verify_ssl: false,
        } as any,
        tenantId,
        staffUserId,
      );
      const secret = created.data.signing_secret;
      expect(typeof secret).toBe('string');
      expect(secret.length).toBeGreaterThan(20);
      // Same secret is what the delivery path will sign with.
      expect(await webhookModel.getSigningSecret(created.data.webhook_id, tenantId)).toBe(secret);

      const ticketId = await createTicket(null);
      await service.addComment(ticketId, { comment_text: 'reply', is_internal: false } as any, staffCtx());

      const forTicket = () =>
        state.jobs.filter((j) => j.eventType === 'ticket.response_state_changed' && j.payload?.ticket_id === ticketId);
      const job = await waitFor(() => forTicket()[0]);
      expect(job.webhookId).toBe(created.data.webhook_id);
      // Exactly one response_state_changed job for this single change.
      expect(forTicket()).toHaveLength(1);

      const result = await processWebhookDeliveryJob(job);
      expect(result.outcome).toBe('delivered');
      expect(stub.received).toHaveLength(1);
      const hit = stub.received[0];
      expect(hit.body).toMatchObject({
        event_type: 'ticket.response_state_changed',
        tenant_id: tenantId,
        data: {
          ticket_id: ticketId,
          previous_response_state: null,
          new_response_state: 'awaiting_client',
          response_state: 'awaiting_client',
        },
      });
      const header = hit.headers[WEBHOOK_SIGNATURE_HEADER.toLowerCase()];
      expect(verifyWebhookSignature(header, hit.bodyRaw, secret)).toBe(true);
    } finally {
      await stub.close();
      TokenBucketRateLimiter.resetInstance();
    }
  });

  it('4b. response_state_changed snapshot matches new state even when the ticket snapshot was cached before the change', async () => {
    clearTicketWebhookPayloadCache();
    const ticketId = await createTicket(null);
    const base = { tenantId, ticketId };

    // Warm the 60s per-ticket cache while response_state is still null.
    const before = await buildTicketWebhookPayload({ eventType: 'TICKET_COMMENT_ADDED', payload: base }, db);
    expect(before.response_state).toBeNull();

    await table('tickets').where({ ticket_id: ticketId }).update({ response_state: 'awaiting_client' });

    const changed = await buildTicketWebhookPayload({
      eventType: 'TICKET_RESPONSE_STATE_CHANGED',
      payload: { ...base, previousResponseState: null, newResponseState: 'awaiting_client' },
    }, db);
    expect(changed.new_response_state).toBe('awaiting_client');
    expect(changed.response_state).toBe('awaiting_client');

    // The stale entry must not leak into the next event either.
    await table('tickets').where({ ticket_id: ticketId }).update({ response_state: 'awaiting_internal' });
    const next = await buildTicketWebhookPayload({ eventType: 'TICKET_COMMENT_ADDED', payload: base }, db);
    expect(next.response_state).toBe('awaiting_internal');
    clearTicketWebhookPayloadCache();
  });

  it('5b. comment.added data.response_state is read fresh from the DB even when the snapshot cache was warmed earlier', async () => {
    await ensureCommentHook();
    clearTicketWebhookPayloadCache();
    const ticketId = await createTicket(null);

    // Warm the per-ticket snapshot cache while response_state is null.
    const warm = await buildTicketWebhookPayload(
      { eventType: 'TICKET_COMMENT_ADDED', payload: { tenantId, ticketId } }, db);
    expect(warm.response_state).toBeNull();

    // A client-visible staff comment moves the state to awaiting_client.
    await service.addComment(ticketId, { comment_text: 'warm cache check', is_internal: false } as any, staffCtx());
    const dbState = await responseStateOf(ticketId);
    expect(dbState).toBe('awaiting_client');

    const job = await commentJobFor(ticketId);
    expect(job.payload.response_state).toBe(dbState);
    clearTicketWebhookPayloadCache();
  });

  it('5. a contact comment webhook payload carries author_type + contact_name in comment and comments[]', async () => {
    await ensureCommentHook();

    const ticketId = await createTicket(null);
    await service.addComment(ticketId, { comment_text: 'from the contact', is_internal: false } as any, clientCtx());

    const job = await waitFor(() =>
      state.jobs.find((j) => j.eventType === 'ticket.comment.added' && j.payload?.ticket_id === ticketId),
);
    expect(job.payload.comment).toMatchObject({
      author_type: 'client',
      contact_id: contactId,
      contact_name: 'Casey Contact',
    });
    expect(Array.isArray(job.payload.comments)).toBe(true);
    const entry = job.payload.comments.find((c: any) => c.contact_name === 'Casey Contact');
    expect(entry).toMatchObject({ author_type: 'client', contact_id: contactId });
  });

  it('6. GET /tickets?response_state=awaiting_internal returns only matching tickets (tenant filtered)', async () => {
    const waiting = await createTicket('awaiting_internal');
    const other = await createTicket('awaiting_client');
    const none = await createTicket(null);

    const result = await service.list(
      { page: 1, limit: 100, filters: { response_state: 'awaiting_internal' } } as any,
      staffCtx(),
    );
    const ids = result.data.map((t: any) => t.ticket_id);
    expect(ids).toContain(waiting);
    expect(ids).not.toContain(other);
    expect(ids).not.toContain(none);
    for (const t of result.data) {
      expect((t as any).response_state).toBe('awaiting_internal');
    }
  });

  it('7. shared helper regression for the UI action path (staff / contact / internal / unknown)', async () => {
    const run = (ticketId: string, userId: string | null, isInternal: boolean) =>
      withTransaction(db, async (trx) => {
        const author = await resolveCommentAuthor(trx, tenantId, userId);
        return {
          author,
          result: await applyCommentResponseState(trx, {
            tenant: tenantId, ticketId, authorType: author.authorType, isInternal, userId,
          }),
        };
      });

    const t1 = await createTicket(null);
    const staff = await run(t1, staffUserId, false);
    expect(staff.author).toEqual({ authorType: 'internal', contactId: null });
    expect(await responseStateOf(t1)).toBe('awaiting_client');

    const contact = await run(t1, clientUserId, false);
    expect(contact.author).toEqual({ authorType: 'client', contactId });
    expect(await responseStateOf(t1)).toBe('awaiting_internal');

    const note = await run(t1, staffUserId, true);
    expect(await responseStateOf(t1)).toBe('awaiting_internal');
    expect(note.result?.newState ?? 'awaiting_internal').toBe('awaiting_internal');

    // Event published exactly once per real transition (2), none for the note.
    await waitFor(() => stateEvents().length >= 2);
    expect(stateEvents()).toHaveLength(2);
  });
});
