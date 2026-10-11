import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import type { Knex } from 'knex';
import { runWithTenant, tenantDb, resetTenantConnectionPool } from '@alga-psa/db';

/**
 * A self-deadlock has no failing symptom: the request simply never returns.
 * PostgreSQL's deadlock detector does not fire, because only one transaction is
 * ever waiting -- the second connection waits on a lock held by the first, and
 * the first is blocked in application code awaiting the second. Nothing times
 * out. So a test that merely *calls* the entry point passes either way, and a
 * test that reproduces the defect hangs CI rather than failing it.
 *
 * These tests make the failure observable. The fixture is committed, so a
 * second connection can see it; a caller transaction then takes
 * `SELECT ... FOR UPDATE` on the row the entry point will write and invokes the
 * entry point with that same transaction. Correct threading runs the write
 * inside the caller's transaction, which already owns the lock, and returns
 * immediately. A regression opens a second pool connection whose UPDATE queues
 * behind the caller's lock, and two independent guards convert that wait into a
 * failure:
 *
 *   1. `lock_timeout` on the application role -- a waiting statement is
 *      cancelled by PostgreSQL with a precise error. The suite bootstrap
 *      (`resetAppRoleGucs`) clears the production role guardrail installed by
 *      20260609120000_set_app_role_db_guardrail_timeouts.cjs, so it is set here
 *      explicitly and reset afterwards.
 *   2. a wall-clock deadline, in case the pool handed out a connection that
 *      predates the role setting.
 *
 * Guards cb65a3444d and the audit in
 * docs/evidence/co-managed-transaction-audit.md.
 */

vi.mock('@alga-psa/storage/StorageProviderFactory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/storage/StorageProviderFactory')>()),
  StorageProviderFactory: {
    // The object store is not what deadlocks; the database writes around it are.
    createProvider: async () => ({ delete: async () => {} }),
  },
}));

vi.mock('@alga-psa/storage/config/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/storage/config/storage')>()),
  getStorageConfig: async () => ({ defaultProvider: 'local' }),
  getProviderConfig: async () => ({ type: 'local', basePath: '/tmp/alga-trx-threading' }),
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: async () => {},
  publishEvent: async () => {},
}));

// The boot sweep re-arms pg-boss schedules after cleaning drafts. That machinery
// is not under test and would require a live job runner.
vi.mock('@/lib/jobs/JobRunnerFactory', () => ({
  getJobRunner: async () => ({ scheduleJobAt: async () => ({ jobId: randomUUID() }) }),
}));

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { StorageService } from '@alga-psa/storage/StorageService';
import { FileStoreModel } from '@alga-psa/storage/models/storage';

const LOCK_TIMEOUT = '2s';
const DEADLINE_MS = 10_000;
const APP_ROLE = (process.env.DB_USER_SERVER || 'app_user').replace(/[^a-zA-Z0-9_]/g, '');

/** Turn "never returns" into a failing assertion. */
async function withDeadline<T>(work: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(
        `${what} did not complete within ${DEADLINE_MS}ms. It is waiting on a row lock the ` +
        `caller already holds, which means it opened a second pool connection instead of ` +
        `threading the supplied transaction. See docs/evidence/co-managed-transaction-audit.md.`,
      )),
      DEADLINE_MS,
    );
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * A committed fixture: an expired, exclusively owned comment-attachment draft,
 * the exact shape the boot sweep walks. Committed on purpose -- a rolled-back
 * fixture is invisible to any second connection, so a regression would fail
 * with 'File not found' instead of demonstrating the lock wait this suite
 * exists to catch.
 */
async function seedExpiredDraft(conn: Knex, ageMs: number) {
  const tenant = randomUUID(), actor = randomUUID(), client = randomUUID(), ticket = randomUUID();
  const document = randomUUID(), file = randomUUID();
  const table = (name: string) => tenantDb(conn, tenant).table(name);

  await tenantDb(conn, tenant)
    .unscoped('tenants', 'create isolated test tenant')
    .insert({ tenant, client_name: 'Transaction threading', email: `${tenant}@example.test`, product_code: 'psa' });
  await table('clients').insert({ tenant, client_id: client, client_name: 'Threading' });
  await table('users').insert({
    tenant, user_id: actor, username: actor, email: `${actor}@example.test`,
    hashed_password: 'unused', user_type: 'internal', is_inactive: false,
  });
  await table('tickets').insert({
    tenant, ticket_id: ticket, ticket_number: `TRX-${ticket.slice(0, 8)}`,
    client_id: client, title: 'Transaction threading', entered_by: actor,
  });
  await table('external_files').insert({
    tenant, file_id: file, file_name: 'report.pdf', original_name: 'report.pdf',
    mime_type: 'application/pdf', file_size: 12, storage_path: `/test/${file}`, uploaded_by_id: actor,
  });
  await table('documents').insert({
    tenant, document_id: document, file_id: file, document_name: 'report.pdf',
    mime_type: 'application/pdf', file_size: 12, user_id: actor, created_by: actor, is_client_visible: true,
  });
  await table('document_associations').insert({ tenant, document_id: document, entity_type: 'ticket', entity_id: ticket });
  await table('ticket_comment_attachments').insert({
    tenant, document_id: document, ticket_id: ticket, created_by: actor,
    state: 'draft', expires_at: new Date(Date.now() - ageMs),
  });

  return { tenant, actor, client, ticket, document, file };
}

/** Children first; a committed fixture has to be removed explicitly. */
async function removeFixture(conn: Knex, tenant: string) {
  const table = (name: string) => tenantDb(conn, tenant).table(name);
  for (const name of ['ticket_comment_attachments', 'document_associations', 'documents',
    'external_files', 'tickets', 'users', 'clients']) {
    await table(name).where({ tenant }).delete().catch(() => {});
  }
  await tenantDb(conn, tenant).unscoped('tenants', 'drop isolated test tenant')
    .where({ tenant }).delete().catch(() => {});
}

/**
 * Point the *application's* connection factory at this suite's database, and set
 * the role guardrail the suite bootstrap clears.
 *
 * Both matter for the same reason: the code under test does not use the handle
 * this file creates. It calls `createTenantKnex()`/`getConnection()`, which build
 * a pool from `DB_NAME_SERVER` at call time. `createTestDbConnection()` sets that
 * variable, but a later `dotenv` load can put the developer's own database name
 * back, and then the sweep runs against a database with no fixture in it and
 * quietly finds nothing to do. Reading the name off the live connection removes
 * the dependency on environment ordering entirely.
 *
 * The pool is destroyed afterwards so its connections are rebuilt with both
 * settings in force.
 */
async function armApplicationPool(conn: Knex) {
  const { rows } = await conn.raw('select current_database() as name');
  process.env.DB_NAME_SERVER = rows[0].name;
  await conn.raw(`ALTER ROLE ${APP_ROLE} SET lock_timeout = '${LOCK_TIMEOUT}'`);
  await resetTenantConnectionPool();
}

async function disarmApplicationPool(conn: Knex | undefined) {
  await conn?.raw(`ALTER ROLE ${APP_ROLE} RESET lock_timeout`).catch(() => {});
  await resetTenantConnectionPool().catch(() => {});
}

/**
 * One database handle for the whole file. Both suites need the same database,
 * and a second `createTestDbConnection()` would race the first one's
 * drop-and-recreate: the second call resolves its name before the first has
 * finished creating it, and fails with `database ... does not exist`.
 */
let conn: Knex;

beforeAll(async () => {
  conn = await createTestDbConnection();
  await armApplicationPool(conn);
}, 180_000);

afterAll(async () => {
  await disarmApplicationPool(conn);
  await conn?.destroy();
});

describe('transaction-accepting entry points under a lock the caller already holds', () => {
  let trx: Knex.Transaction;
  let fixture: Awaited<ReturnType<typeof seedExpiredDraft>>;

  const table = (name: string) => tenantDb(trx, fixture.tenant).table(name);

  beforeEach(async () => {
    fixture = await seedExpiredDraft(conn, 86_400_000);
    trx = await conn.transaction();
  });

  afterEach(async () => {
    await trx?.rollback().catch(() => {});
    await removeFixture(conn, fixture.tenant);
  });

  /** Exactly what cleanupCommentAttachmentDrafts holds when it calls deleteFile. */
  async function lockFileRow() {
    const locked = await table('external_files').where({ file_id: fixture.file }).forUpdate().first();
    expect(locked, 'fixture row must exist and be lockable').toBeTruthy();
  }

  it('StorageService.deleteFile writes on the caller transaction, not a second connection', async () => {
    await lockFileRow();

    await withDeadline(
      runWithTenant(fixture.tenant, () => StorageService.deleteFile(fixture.file, fixture.actor, trx)),
      'StorageService.deleteFile(file, actor, trx)',
    );

    // The soft delete is visible inside the caller's transaction...
    const inTransaction = await table('external_files').where({ file_id: fixture.file }).first();
    expect(inTransaction.deleted_at, 'deleteFile must soft-delete on the supplied transaction').toBeTruthy();
    // ...and only there. A second connection would have had to commit its own
    // transaction for the change to be visible outside this one.
    const outside = await tenantDb(conn, fixture.tenant).table('external_files').where({ file_id: fixture.file }).first();
    expect(outside.deleted_at, 'the write must not have committed on another connection').toBeNull();
  }, 60_000);

  it('FileStoreModel.softDelete writes on the caller transaction', async () => {
    await lockFileRow();

    const deleted = await withDeadline(
      runWithTenant(fixture.tenant, () => FileStoreModel.softDelete(trx, fixture.file, fixture.actor)),
      'FileStoreModel.softDelete(trx, file, actor)',
    );

    expect(deleted.deleted_at).toBeTruthy();
  }, 60_000);

  it('FileStoreModel.updateMetadata writes on the caller transaction', async () => {
    await lockFileRow();

    await withDeadline(
      runWithTenant(fixture.tenant, () => FileStoreModel.updateMetadata(trx, fixture.file, { audited: true })),
      'FileStoreModel.updateMetadata(trx, file, metadata)',
    );

    const row = await table('external_files').where({ file_id: fixture.file }).first();
    expect(row.metadata).toMatchObject({ audited: true });
  }, 60_000);

  /**
   * The end-to-end shape of the incident: the sweep takes `FOR UPDATE` on
   * external_files itself and then calls the real `StorageService.deleteFile`
   * through its default `remove`. This is the test that would have hung before
   * cb65a3444d, because every other cleanup test injects a fake `remove` and so
   * never reaches StorageService at all.
   */
  it('cleanupCommentAttachmentDrafts completes with the real StorageService.deleteFile', async () => {
    const { cleanupCommentAttachmentDrafts } = await import('@/lib/jobs/handlers/cleanupCommentAttachmentDrafts');

    await withDeadline(
      runWithTenant(fixture.tenant, () => cleanupCommentAttachmentDrafts(trx, fixture.tenant)),
      'cleanupCommentAttachmentDrafts(trx, tenant)',
    );

    expect(await table('documents').where({ document_id: fixture.document }).first()).toBeUndefined();
    const attachment = await table('ticket_comment_attachments').where({ document_id: fixture.document }).first();
    expect(attachment.cleanup_completed_at, 'the draft must be marked swept').toBeTruthy();
    const row = await table('external_files').where({ file_id: fixture.file }).first();
    expect(row.deleted_at, 'the backing file must be soft-deleted').toBeTruthy();
  }, 60_000);
});

/**
 * Deliverable 3: the boot path that took the application down.
 *
 * `initializeApp()` awaits `reconcileScheduledCommentPublications()`, which
 * sweeps expired comment-attachment drafts before anything else in the runner
 * block can proceed. `initializeApp()` runs inside instrumentation `register()`,
 * so while that sweep is blocked no HTTP request is served. Every existing
 * cleanup test injects a fake `remove`, so none of them ever reached
 * `StorageService.deleteFile` -- the sweep having *work to do* against the real
 * storage entry point was uncovered, which is why the boot wedge shipped.
 */
describe('initializeApp boot sweep with expired drafts present', () => {
  let fixture: Awaited<ReturnType<typeof seedExpiredDraft>>;

  // Two days old: comfortably past the 24h grace, so the sweep has work to do.
  beforeEach(async () => { fixture = await seedExpiredDraft(conn, 2 * 86_400_000); });
  afterEach(async () => { await removeFixture(conn, fixture.tenant); });

  it('completes the draft sweep the boot path runs, with drafts past the grace present', async () => {
    const { reconcileScheduledCommentPublications } = await import('@/lib/jobs/handlers/publishScheduledCommentHandler');

    // The sweep reaches the database through the application's own connection
    // factory, not through this file's handle. If that factory is pointed at a
    // different database the sweep finds no candidates, completes instantly and
    // every timing assertion below passes for the wrong reason. Check first.
    const { getConnection } = await import('@alga-psa/db');
    const sweepSees = await tenantDb(await getConnection(null), fixture.tenant)
      .table('ticket_comment_attachments').where({ document_id: fixture.document }).first();
    expect(sweepSees, 'the application connection must reach the fixture, or the sweep is a no-op').toBeTruthy();

    await withDeadline(
      reconcileScheduledCommentPublications(false, fixture.tenant),
      'reconcileScheduledCommentPublications() (the initializeApp draft sweep)',
    );

    const attachment = await tenantDb(conn, fixture.tenant).table('ticket_comment_attachments')
      .where({ document_id: fixture.document }).first();
    expect(attachment.cleanup_completed_at, 'the expired draft must be swept, not skipped').toBeTruthy();
    const row = await tenantDb(conn, fixture.tenant).table('external_files')
      .where({ file_id: fixture.file }).first();
    expect(row.deleted_at, 'the backing file must be soft-deleted by the real StorageService.deleteFile').toBeTruthy();
  }, 60_000);

  /**
   * The test above exercises the sweep directly: running all of `initializeApp()`
   * would need a live Redis, job runner and event bus, and mocking those out
   * would leave a test of the mocks. This keeps the two bound together, so the
   * coverage claim cannot quietly stop being about the boot path.
   */
  it('is the function initializeApp awaits during instrumentation register()', () => {
    const source = readFileSync(resolvePath(__dirname, '../../lib/initializeApp.ts'), 'utf-8');
    expect(source).toContain('await reconcileScheduledCommentPublications()');
  });
});
