import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import knex, { type Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createClient } from 'redis';

// End-to-end acceptance test for alga-2026-0002379: a TICKET_CREATED workflow must start for a ticket
// created from inbound email.
//
// Real links: TicketModel.createTicket (via createTicketFromEmail) -> InboundEmailOutboxEventPublisher
// writing the inbound_email_outbox row -> the real outbox dispatcher (processInboundOutboxJob) -> the real
// EventBus.publish -> XADD to workflow:events:global in Redis -> parseStreamEvent on the stream entry ->
// WorkflowRuntimeV2EventStreamWorker.processEvent against the real database with a really published
// TICKET_CREATED workflow definition.
// Stubbed links: MIME staging/parsing (createTicketFromEmail is called with the inputs
// processInboundEmailInApp derives, not a raw message) and the Temporal start (the run row is real,
// the Temporal workflow start is not).
//
// Needs a migrated AND seeded database plus the local-test Redis. Plain `npm test` skips it without
// TEST_DB_NAME; with REQUIRE_DB=1 or vitest.db.config.ts a missing TEST_DB_NAME or a stubbed `redis` throws.
//
// Ports: Postgres 127.0.0.1:5472 (the instance server/test-utils/dbConfig.ts bootstraps against; 5474 is a
// different instance and has no app_user test DBs), Redis 127.0.0.1:6380. Passwords come from the checkout's
// secrets/ directory (postgres_password, db_password_server, redis_password), read below.
//
// Recipe, from nothing to green (run from the repo/worktree root):
//   1. Create + migrate + seed a dedicated DB. The server TestContext bootstrap drops/recreates
//      $TEST_DB_NAME, runs server/migrations and the seeds, so this smoke test is the bootstrap:
//        cd server && TEST_DB_NAME=alga2379_wfw_test \
//          npx vitest run src/test/integration/workflowWorkerV2.inboundEmailSmoke.integration.test.ts --coverage.enabled=false
//   2. Run this test through the DB config (forces the real node-redis client by setting REAL_REDIS=1):
//        cd services/workflow-worker && TEST_DB_NAME=alga2379_wfw_test \
//          npx vitest run --config vitest.db.config.ts src/v2/WorkflowRuntimeV2EventStreamWorker.inboundEmailTicketCreated.db.test.ts
//   A migrated-but-unseeded DB fails with `Expected seeded tenant`. The test cleans up what it creates
//   (tickets, outbox rows, runtime events, the workflow definition, its stream entries), so it can be rerun.

const requireInfra = process.env.REQUIRE_DB === '1' || process.env.DB_TEST_CONFIG === '1';
const dbConfigured = Boolean(process.env.TEST_DB_NAME);
if (!dbConfigured && requireInfra) {
  throw new Error('inboundEmailTicketCreated.db requires TEST_DB_NAME (REQUIRE_DB=1 or vitest.db.config.ts was used)');
}
if (dbConfigured && process.env.REAL_REDIS !== '1') {
  // The repo-root vitest config aliases `redis` to a no-op stub unless REAL_REDIS=1, so both this test and the
  // EventBus would get a client without xAdd/xGroupCreate and fail obscurely.
  throw new Error('inboundEmailTicketCreated.db needs the real redis client: run with --config vitest.db.config.ts (sets REAL_REDIS=1)');
}

const secretsDir = path.resolve(__dirname, '../../../../secrets');
const readSecret = (name: string): string | undefined => {
  try {
    return fs.readFileSync(path.join(secretsDir, name), 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
};

const { state, startRunMock, getCurrentUserMock } = vi.hoisted(() => ({
  state: { db: null as any, tenantId: '', userId: '' },
  startRunMock: vi.fn(),
  getCurrentUserMock: vi.fn(),
}));

if (dbConfigured) {
  process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
  process.env.DB_PORT = process.env.DB_PORT || '5472';
  process.env.DB_NAME_SERVER = process.env.TEST_DB_NAME;
  process.env.DB_USER_ADMIN = 'postgres';
  process.env.DB_USER_SERVER = 'app_user';
  process.env.DB_PASSWORD_ADMIN = readSecret('postgres_password') || 'postpass123';
  process.env.DB_PASSWORD_SERVER = readSecret('db_password_server') || 'postpass123';
  process.env.REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
  process.env.REDIS_PORT = process.env.REDIS_PORT || '6380';
  process.env.REDIS_PASSWORD = process.env.REDIS_PASSWORD || readSecret('redis_password') || '';
}

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: vi.fn(async () => state.db),
  destroyAdminConnection: vi.fn(async () => undefined),
}));
vi.mock('@shared/db/admin.js', () => ({ getAdminConnection: async () => state.db }));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    createTenantKnex: vi.fn(async () => ({ knex: state.db, tenant: state.tenantId })),
    getCurrentTenantId: vi.fn(() => state.tenantId),
    auditLog: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('@alga-psa/auth', () => {
  const user = () => ({ user_id: state.userId, tenant: state.tenantId, roles: [] });
  const withAuth = (action: (user: any, ctx: { tenant: string }, ...args: any[]) => Promise<any>) =>
    async (...args: any[]) => action(user(), { tenant: state.tenantId }, ...args);
  return {
    withAuth,
    withOptionalAuth: withAuth,
    withAuthCheck: (action: (user: any, ...args: any[]) => Promise<any>) => async (...args: any[]) => action(user(), ...args),
    AuthenticationError: class AuthenticationError extends Error {},
    hasPermission: vi.fn().mockResolvedValue(true),
    checkMultiplePermissions: vi.fn().mockResolvedValue(true),
    getCurrentUser: getCurrentUserMock,
    preCheckDeletion: vi.fn(),
  };
});

vi.mock('@alga-psa/workflows/lib/workflowRuntimeV2Temporal', () => ({
  startWorkflowRuntimeV2TemporalRun: (...args: unknown[]) => startRunMock(...args),
}));

const STREAM = 'workflow:events:global';

describe.skipIf(!dbConfigured)('inbound email -> TICKET_CREATED workflow launch (DB + Redis, alga-2026-0002379)', () => {
  let db: Knex;
  let redis: ReturnType<typeof createClient>;
  let tenantId: string;
  let clientId: string;
  let boardId: string;
  let statusId: string;
  let priorityId: string;
  let userId: string;
  let workflowId: string | undefined;
  const streamIds: string[] = [];
  const ticketIds: string[] = [];
  const eventIds: string[] = [];

  beforeAll(async () => {
    db = knex({
      client: 'pg',
      connection: {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        user: 'postgres',
        password: process.env.DB_PASSWORD_ADMIN,
        database: process.env.TEST_DB_NAME,
      },
      pool: { min: 0, max: 4 },
    });
    state.db = db;

    const tenant = await db('tenants').first('tenant');
    if (!tenant?.tenant) throw new Error('Expected seeded tenant');
    tenantId = state.tenantId = tenant.tenant;
    clientId = (await db('clients').where({ tenant: tenantId }).first('client_id')).client_id;
    const status = await db('statuses').where({ tenant: tenantId, status_type: 'ticket', is_default: true }).whereNotNull('board_id').first('status_id', 'board_id');
    statusId = status.status_id;
    boardId = status.board_id;
    priorityId = (await db('priorities').where({ tenant: tenantId }).first('priority_id')).priority_id;
    userId = state.userId = (await db('users').where({ tenant: tenantId }).first('user_id')).user_id;
    getCurrentUserMock.mockResolvedValue({ user_id: userId, tenant: tenantId, roles: [] });
    startRunMock.mockResolvedValue({ workflowId: 'workflow-runtime-v2:run:e2e', firstExecutionRunId: 'temporal-e2e' });

    redis = createClient({
      url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,
      password: process.env.REDIS_PASSWORD || undefined,
    });
    await redis.connect();
    if (typeof redis.xAdd !== 'function') {
      throw new Error('redis client has no xAdd: the `redis` stub alias is active; run with --config vitest.db.config.ts');
    }

    // Both tests need the runtime registries and a published TICKET_CREATED workflow; vitest shuffles
    // test order, so this cannot live inside one test (a lone stale-payload test saw unknown_schema_ref).
    const { createWorkflowDefinitionAction, publishWorkflowDefinitionAction } = await import('@alga-psa/workflows/actions');
    const { initializeWorkflowRuntimeV2 } = await import('@alga-psa/workflows/runtime');
    initializeWorkflowRuntimeV2();

    const created = await createWorkflowDefinitionAction({
      definition: {
        id: uuidv4(),
        version: 1,
        name: `Inbound email ticket created ${uuidv4().slice(0, 6)}`,
        description: 'alga-2026-0002379 acceptance',
        payloadSchemaRef: 'payload.TicketCreated.v1',
        trigger: { type: 'event', eventName: 'TICKET_CREATED' },
        steps: [{ id: 'state-1', type: 'state.set', config: { state: 'READY' } } as any],
      },
    });
    workflowId = created.workflowId;
    const publish: any = await publishWorkflowDefinitionAction({ workflowId, version: 1 });
    expect(JSON.stringify(publish?.errors ?? [])).toBe('[]');
    expect(publish?.ok).toBe(true);
  }, 120_000);

  afterAll(async () => {
    if (redis?.isOpen) {
      if (streamIds.length) await redis.xDel(STREAM, streamIds).catch(() => undefined);
      await redis.quit().catch(() => undefined);
    }
    if (db) {
      for (const ticketId of ticketIds) {
        await db('workflow_runtime_events').where({ tenant: tenantId }).whereRaw("payload->>'ticketId' = ?", [ticketId]).delete().catch(() => undefined);
        for (const table of ['ticket_audit_logs', 'comments', 'ticket_activity_log']) {
          await db(table).where({ tenant: tenantId, ticket_id: ticketId }).delete().catch(() => undefined);
        }
        await db('tickets').where({ tenant: tenantId, ticket_id: ticketId }).delete().catch(() => undefined);
      }
      if (eventIds.length) {
        await db('workflow_event_launch_skips').where({ tenant: tenantId }).whereIn('event_id', eventIds).delete().catch(() => undefined);
        await db('workflow_runtime_events').where({ tenant: tenantId }).whereIn('event_id', eventIds).delete().catch(() => undefined);
      }
      await db('inbound_email_outbox').where({ tenant: tenantId }).whereIn('ticket_id' as any, ticketIds).delete().catch(() => undefined);
      // Runs, steps and versions cascade from the definition.
      if (workflowId) await db('workflow_definitions').where({ workflow_id: workflowId }).delete().catch(() => undefined);
      await db.destroy();
    }
  });

  it('starts the published TICKET_CREATED workflow for a new inbound-email ticket', async () => {
    // Durable inbound: an inbox row owns the outbox rows written in the ticket transaction.
    const { upsertIngress, upsertInbox } = await import('@alga-psa/shared/services/email/inboundEmailDurableStore');
    const providerId = uuidv4();
    const messageId = `e2e-${uuidv4()}@example.com`;
    const defaultsId = uuidv4();
    await db('inbound_ticket_defaults').insert({
      id: defaultsId, tenant: tenantId, short_name: `e2e-${defaultsId.slice(0, 6)}`, display_name: `E2E ${defaultsId.slice(0, 6)}`,
      description: 'e2e', board_id: boardId, status_id: statusId, priority_id: priorityId, client_id: clientId,
      entered_by: userId, is_active: true, is_default: false,
    });
    await db('email_providers').insert({
      id: providerId, tenant: tenantId, provider_type: 'google', provider_name: 'e2e provider',
      mailbox: `e2e-${providerId.slice(0, 6)}@example.com`, is_active: true, status: 'connected', inbound_ticket_defaults_id: defaultsId,
    });
    const ingress = await upsertIngress(db, {
      tenant: tenantId, provider_id: providerId, provider_type: 'google', ingress_key: `e2e:${messageId}`, provider_pointer: { messageId },
    });
    const inbox = await upsertInbox(db, {
      tenant: tenantId, ingress_id: ingress.ingress_id, provider_id: providerId, provider_type: 'google',
      normalized_message_id: messageId, provider_message_id: messageId, rfc_message_id: messageId,
      source_object_key: `e2e/${messageId}`, source_sha256: 'e2e', source_size_bytes: 1, source_staged_at: new Date(), envelope: { messageId },
    });

    const { withAdminTransaction } = await import('@alga-psa/db');
    const { createTicketFromEmail } = await import('@alga-psa/shared/workflow/actions/emailWorkflowActions');
    const { InboundEmailOutboxEventPublisher } = await import('@alga-psa/shared/workflow/adapters/inboundEmailOutboxEventPublisher');
    const ticket = await withAdminTransaction(async (trx: any) => {
      const publisher = new InboundEmailOutboxEventPublisher({ trx, tenantId, inboxId: inbox.inbox_id, suppressCommentEmail: true });
      return createTicketFromEmail(
        {
          title: 'Inbound email workflow trigger',
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
    });
    ticketIds.push(ticket.ticket_id);

    const outboxRow = await db('inbound_email_outbox').where({ tenant: tenantId, inbox_id: inbox.inbox_id, event_type: 'TICKET_CREATED' }).first();
    expect(outboxRow).toBeTruthy();

    // Dispatcher -> real EventBus -> workflow:events:global.
    const { processInboundOutboxJob } = await import('@alga-psa/shared/services/email/inboundEmailOutboxDispatcher');
    const result = await processInboundOutboxJob(
      {
        schemaVersion: 2, workType: 'publish_outbox', tenantId, recordId: String(outboxRow.outbox_id), inboxId: inbox.inbox_id,
        jobId: `e2e-${uuidv4()}`, enqueuedAt: new Date().toISOString(), attempt: 0, maxAttempts: 5,
      } as any,
      { signal: new AbortController().signal, renew: async () => true, registerPostgresLease: () => undefined }
    );
    expect(result.disposition).toBe('ack');

    const entries = await redis.xRange(STREAM, '-', '+');
    const entry = entries.filter((e) => e.message.event_type === 'TICKET_CREATED' && e.message.tenant === tenantId && e.message.payload_json?.includes(ticket.ticket_id)).pop();
    expect(entry).toBeTruthy();
    streamIds.push(entry!.id);

    const { parseStreamEvent } = await import('@alga-psa/event-schemas');
    const event = parseStreamEvent({ id: entry!.id, message: entry!.message } as any);
    // The payload on the wire is exactly what the worker is handed; it must carry occurredAt.
    expect(typeof (event.payload as any).occurredAt).toBe('string');
    eventIds.push(event.event_id);

    const { WorkflowRuntimeV2EventStreamWorker } = await import('./WorkflowRuntimeV2EventStreamWorker.js');
    const worker = new WorkflowRuntimeV2EventStreamWorker('inbound-email-e2e', { recordLaunchSkip: vi.fn(), recordLaunch: vi.fn() } as any);
    await (worker as any).processEvent(event);

    const eventRow = await db('workflow_runtime_events').where({ tenant: tenantId, event_id: event.event_id }).first();
    expect(eventRow).toBeTruthy();
    expect(eventRow.matched_run_id).toBeTruthy();
    expect(typeof eventRow.payload.occurredAt).toBe('string');
    const skips = await db('workflow_event_launch_skips').where({ tenant: tenantId, event_id: event.event_id, reason: 'payload_validation_failed' });
    expect(skips).toHaveLength(0);
    expect(startRunMock).toHaveBeenCalled();
  }, 120_000);

  // Production still saw rejects after the producer-side stamps shipped: every rejected payload had the
  // pre-actor-fields key set (source,userId,board_id,tenantId,ticketId,client_id,priority_id) and no
  // occurredAt, i.e. it was written to the stream by a producer that predates the stamps. This builds the
  // legacy key set from the same seeded ids and puts it on the real
  // stream, so the consumer boundary is exercised exactly as production exercised it.
  it('starts the workflow when a stale producer puts a payload without occurredAt on the stream', async () => {
    const legacy = { tenantId, ticketId: uuidv4(), userId, source: 'email', board_id: boardId, priority_id: priorityId, client_id: clientId };
    const eventId = uuidv4();
    eventIds.push(eventId);
    const id = await redis.xAdd(STREAM, '*', {
      event_id: eventId, execution_id: '', event_name: 'TICKET_CREATED', event_type: 'TICKET_CREATED', tenant: tenantId,
      timestamp: new Date().toISOString(), user_id: '', from_state: '', to_state: '', payload_json: JSON.stringify(legacy),
    });
    streamIds.push(id);

    const entry = (await redis.xRange(STREAM, id, id))[0]!;
    const { parseStreamEvent } = await import('@alga-psa/event-schemas');
    const event = parseStreamEvent({ id: entry.id, message: entry.message } as any);
    expect(Object.keys(event.payload as object).sort()).toEqual(
      ['board_id', 'client_id', 'priority_id', 'source', 'tenantId', 'ticketId', 'userId']
    );

    const { WorkflowRuntimeV2EventStreamWorker } = await import('./WorkflowRuntimeV2EventStreamWorker.js');
    const worker = new WorkflowRuntimeV2EventStreamWorker('inbound-email-e2e-stale', { recordLaunchSkip: vi.fn(), recordLaunch: vi.fn() } as any);
    await (worker as any).processEvent(event);

    const eventRow = await db('workflow_runtime_events').where({ tenant: tenantId, event_id: eventId }).first();
    expect(eventRow.matched_run_id).toBeTruthy();
    expect(eventRow.payload.occurredAt).toBe(event.timestamp);
    const skips = await db('workflow_event_launch_skips').where({ tenant: tenantId, event_id: eventId, reason: 'payload_validation_failed' });
    expect(skips).toHaveLength(0);
  }, 120_000);
});
