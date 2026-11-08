/**
 * L0b neutrality: hot paths touched by the substrate registries issue exactly the
 * statements they did before. A knex dialect recorder captures every statement;
 * HOTPATH_OUT=<prefix> writes the capture compared by scripts/review/hotpath-diff.mjs
 * between the base commit and HEAD. Needs a migrated disposable database
 * (HOTPATH_DB=1, DB_HOST/DB_PORT/DB_NAME_SERVER/DB_USER_ADMIN/DB_PASSWORD_ADMIN). Run with
 * --sequence.shuffle=false: scenarios share a fixture tenant and the fan-out tick counts tenants.
 *
 * Ticket open, ticket status update, comment add and comment edit are driven
 * through the model/action layer directly (withAuth and the event bus are stubbed;
 * the SQL path is real) against a fixture tenant. Only the withAuth bootstrap needs a
 * running server (session/auth); it is not exercised here.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
// @ts-expect-error plain ESM helper
import { startRecording, emitStep } from '../../../../scripts/review/hotpathRecorder.mjs';

const enabled = process.env.HOTPATH_DB === '1';

const ctx = vi.hoisted(() => ({ knex: null as any, tenant: '', user: null as any }));

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  createTenantKnex: vi.fn(async () => ({ knex: ctx.knex, tenant: ctx.tenant })),
}));
// CM L0c A2: a real request's getCurrentUser hands the session product code to write admission
// (noteTenantProductCode) before any action body runs. The stub does the same, so the capture shows
// what a PSA request pays under production config. HOTPATH_SEED_PRODUCT_CODE=0 turns the seed off to
// show the cold `tenants.product_code` read the seam removes.
async function seedSessionProductCode(tenant: string) {
  if (process.env.HOTPATH_SEED_PRODUCT_CODE === '0') return;
  const { noteTenantProductCode } = await import('@alga-psa/db');
  noteTenantProductCode(tenant, 'psa');
}
vi.mock('@alga-psa/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/auth')>()),
  withAuth: (action: any) => async (...args: any[]) => {
    await seedSessionProductCode(ctx.tenant);
    return action(ctx.user, { tenant: ctx.tenant }, ...args);
  },
  hasPermission: vi.fn(async () => true),
}));
const publishEventMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: publishEventMock,
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishNonCatalogWorkflowEvent: vi.fn(async () => undefined),
  publishStoredWorkflowEvent: (...args: any[]) => (publishEventMock as any)(...args),
  publishBuiltWorkflowPayload: vi.fn(async () => undefined),
  publishNonCatalogEventByName: vi.fn(async () => undefined),
  publishUnregisteredEventType: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/tickets/actions/ticketBundleUtils', () => ({
  maybeReopenBundleMasterFromChildReply: vi.fn(),
  revertBundlePropagationForChild: vi.fn(),
}));
vi.mock('../../../../packages/tickets/src/lib/liveUpdates', () => ({ publishTicketUpdate: vi.fn() }));

const noopPublisher: any = new Proxy({}, { get: () => async () => undefined });
const blockNote = (text: string) => JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text, styles: {} }] }]);

async function ticketFixture() {
  const { getAdminConnection } = await import('@alga-psa/db/admin');
  const { createTenant, createClient, createUser } = await import('../../../test-utils/testDataFactory');
  const admin = await getAdminConnection();
  const tenant = await createTenant(admin, 'hotpath ticket fixture');
  const clientId = await createClient(admin, tenant, 'hotpath client');
  const userId = await createUser(admin, tenant, { user_type: 'internal' });
  const boardId = randomUUID();
  const statusOpen = randomUUID();
  const statusProgress = randomUUID();
  const priorityId = randomUUID();
  await admin('boards').insert({ tenant, board_id: boardId, board_name: 'hotpath board', is_default: true, is_inactive: false });
  await admin('statuses').insert([
    { tenant, status_id: statusOpen, name: 'New', status_type: 'ticket', order_number: 1, is_closed: false, is_default: true, board_id: boardId, created_by: userId },
    { tenant, status_id: statusProgress, name: 'In Progress', status_type: 'ticket', order_number: 2, is_closed: false, is_default: false, board_id: boardId, created_by: userId },
  ]);
  await admin('priorities').insert({ tenant, priority_id: priorityId, priority_name: 'Normal', order_number: 1, color: '#888888', item_type: 'ticket', created_by: userId });
  ctx.knex = admin;
  ctx.tenant = tenant;
  // The factory writes above went through guarded builders and warmed the admission cache. Measured
  // steps must see a fresh process's first write, so start from an empty cache (absent on the base commit).
  try { (await import('@alga-psa/db/testing') as any).clearWriteAdmissionCacheForTests?.(); } catch { /* base commit */ }
  await seedSessionProductCode(tenant);
  ctx.user = { user_id: userId, user_type: 'internal', first_name: 'Test', last_name: 'User' };
  return { admin, tenant, clientId, userId, boardId, statusOpen, statusProgress, priorityId };
}

describe.skipIf(!enabled)('hot path query budget', () => {
  // Production config: server/src/instrumentation.ts always installs the co-managed resolver.
  // The base commit has no such module, so the install is skipped there (the capture is what is compared).
  beforeAll(async () => {
    try {
      const { installCoManagedWriteAdmission } = await import('@alga-psa/licensing/co-managed-write-admission');
      installCoManagedWriteAdmission();
    } catch { /* base commit: nothing to install */ }
  });

  it('with-transaction-after-commit', async () => {
    const { getAdminConnection } = await import('@alga-psa/db/admin');
    const { withTransaction, registerAfterCommit } = await import('@alga-psa/db');
    const admin = await getAdminConnection();
    const recorder = startRecording();
    let ran = 0;
    await withTransaction(admin, async (trx) => {
      registerAfterCommit(trx, () => { ran += 1; });
      await trx('tenants').select('tenant').limit(1);
      await withTransaction(trx, async (child) => {
        registerAfterCommit(child, () => { ran += 1; });
        await child('tenants').select('tenant').limit(1);
      });
    });
    recorder.stop();
    expect(ran).toBe(2);
    emitStep('with-transaction-after-commit', recorder.statements);
  });

  it('expired-credits-fanout-tick', async () => {
    const { getAdminConnection } = await import('@alga-psa/db/admin');
    const { runMaintenanceJob } = await import('@alga-psa/jobs/lib/maintenanceJobFanout');
    const admin = await getAdminConnection();
    const tenant = randomUUID();
    await admin('tenants').insert({ tenant, client_name: 'hotpath fixture', email: 'fixture@example.com' });
    const recorder = startRecording();
    const result = await runMaintenanceJob('expired-credits', { concurrency: 1 });
    recorder.stop();
    await admin('tenants').where({ tenant }).delete();
     expect(result).toMatchObject({ scope: 'tenant', failed: 0 });
    // A1: the registry fallback adds no probes to the native fan-out.
    expect(recorder.statements.some((s: { sql: string }) => /co_manag/.test(s.sql))).toBe(false);
    emitStep('expired-credits-fanout-tick', recorder.statements);
  }, 120_000);

  // ---- model/action layer scenarios (fixture tenant, real SQL, stubbed bus) ----
  let fixture: Awaited<ReturnType<typeof ticketFixture>> | undefined;
  let ticketId = '';
  let commentId = '';

  // The suite shuffles test order; these steps depend on each other, so they run in one test.
  it('ticket-and-comment-scenarios', async () => {
    await (async () => {
    fixture = await ticketFixture();
    const { TicketModel } = await import('../../../../shared/models/ticketModel');
    const { withTransaction } = await import('@alga-psa/db');
    const f = fixture;
    const recorder = startRecording();
    const created = await withTransaction(f.admin, (trx) => TicketModel.createTicket({
      title: 'hotpath ticket', client_id: f.clientId, board_id: f.boardId, status_id: f.statusOpen,
      priority_id: f.priorityId, entered_by: f.userId, source: 'web_app', ticket_origin: 'internal',
    } as any, f.tenant, trx, {}, noopPublisher, undefined, f.userId));
    recorder.stop();
    ticketId = created.ticket_id;
    expect(ticketId).toBeTruthy();
    emitStep('ticket-open', recorder.statements);
    })();
    await (async () => {
    const f = fixture!;
    const { TicketModel } = await import('../../../../shared/models/ticketModel');
    const { withTransaction } = await import('@alga-psa/db');
    const recorder = startRecording();
    await withTransaction(f.admin, (trx) => TicketModel.updateTicket(
      ticketId, { status_id: f.statusProgress, updated_by: f.userId }, f.tenant, trx, {}, noopPublisher, undefined, f.userId));
    recorder.stop();
    emitStep('ticket-status-update', recorder.statements);
    })();
    await (async () => {
    const f = fixture!;
    const { createComment } = await import('../../../../packages/tickets/src/actions/comment-actions/commentActions');
    const recorder = startRecording();
    commentId = await createComment({
      ticket_id: ticketId, user_id: f.userId, note: blockNote('hotpath comment'),
      is_internal: false, is_resolution: false,
    } as any) as any;
    recorder.stop();
    expect(commentId).toBeTruthy();
    emitStep('comment-add', recorder.statements);
    })();
    await (async () => {
    const f = fixture!;
    const { updateComment } = await import('../../../../packages/tickets/src/actions/comment-actions/commentActions');
    const recorder = startRecording();
    await updateComment(commentId, { note: blockNote('hotpath comment edited'), user_id: f.userId } as any);
    recorder.stop();
    emitStep('comment-edit', recorder.statements);
    })();
    await (async () => {
    const f = fixture!;
    const { TicketModel } = await import('../../../../shared/models/ticketModel');
    const { withTransaction } = await import('@alga-psa/db');
    const recorder = startRecording();
    await withTransaction(f.admin, (trx) => TicketModel.createComment({
      ticket_id: ticketId, content: blockNote('model comment'), is_internal: false, author_type: 'internal', author_id: f.userId,
    } as any, f.tenant, trx, noopPublisher, undefined, f.userId));
    recorder.stop();
    emitStep('model-comment-add', recorder.statements);
    })();
  }, 120_000);
});
