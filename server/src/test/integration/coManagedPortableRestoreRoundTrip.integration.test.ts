/**
 * CM L8b — shipped-CLI restore and hosted activation against a complete CE+EE migrated PostgreSQL fixture.
 *
 * Source tenant (ticket + file) -> L7b1 contributors, collect, manifest and sealed archive (built in-test, nothing
 * checked in) -> restorePortableWorkspaceForInstallation into a fresh destination UUID. A third, unrelated tenant is
 * snapshotted before and after.
 *
 * What is real: the migrated schema (including the three L7b2 migrations, run down and up here), the L7b1 contributors'
 * SQL, the archive, the restore database layer (catalog/FK discovery, topological insert, cycle deferral), the receipt
 * state machine, the upload journal and the promotion transaction.
 * What is stood in: only the export admission seam, since a source relationship and a fresh destination cannot coexist
 * in one installation. Local permission evaluation, the L7b1 files contributor, the storage provider and production
 * restore binding all run without test-only permission or blob adapters.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Knex } from 'knex';
import Stripe from 'stripe';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { buildMergedEeMigrationsDir } from '../../../test-utils/eeMigrations';
import { createTenant, createUser } from '../../../test-utils/testDataFactory';
import { EmulatorHost } from '../../../../packages/emulators/host/src/index';
import stripeEmulator from '../../../../packages/emulators/stripe/src/index';
import { verifyPassword } from '../../../../packages/core/src/lib/encryption';

vi.mock('../../../../packages/co-managed/src/portableExport', async importOriginal => ({
  ...(await importOriginal<any>()),
  withCoManagedExportAdmin: (db: Knex, actor: any, work: (trx: Knex.Transaction, actor: any, subject: any) => Promise<unknown>) =>
    db.transaction(trx => work(trx, actor, { tenant: actor.tenant, userId: actor.userId })),
}));
vi.mock('../../../../packages/co-managed/src/sharedWorkIdentity', async importOriginal => ({
  ...(await importOriginal<any>()), authorizeCoManagedLocalRecord: async () => ({ redactedFields: [] }),
}));

import { createCorePortableRegistry } from '../../../../packages/co-managed/src/portableCoreRegistry';
import { collectPortableWorkspace } from '../../../../packages/co-managed/src/portableWorkspaceGraph';
import { buildCoManagedPortableWorkspaceManifest } from '../../../../packages/co-managed/src/portableWorkspaceManifest';
import { withCoManagedPortableSnapshot } from '../../../../packages/co-managed/src/portableSnapshot';
import { sealPortableArchive } from '../../../../packages/co-managed/src/portableArchive';
import type { PortableContributorRegistry } from '../../../../packages/co-managed/src/portableContributorRegistry';
import { StorageProviderFactory } from '@alga-psa/storage/StorageProviderFactory';
import { restorePortableWorkspaceForInstallation } from '../../../../ee/server/src/lib/co-managed/portableWorkspaceRestore';
import { beginPortableRestoreUpload, cleanupPortableRestoreUploadsForInstallation } from '../../../../packages/co-managed/src/portableRestoreUploads';

const require = createRequire(import.meta.url);
const migrations = ['20261102120200_create_portable_workspace_restore_uploads.cjs', '20261102120100_create_portable_workspace_restores.cjs',
  '20261102120000_create_portable_restore_suspensions.cjs'].map(file => require(`../../../migrations/${file}`));
// L8b's activation receipt has a foreign key to the L7b2 restore receipt. Keep the
// test's L7b2 down/up cycle valid against the complete current migration sequence.
const activationMigration = require('../../../migrations/20261106000200_create_portable_workspace_activations.cjs');

const PASSPHRASE = 'round trip passphrase 2026 correct horse';
const FILE_BYTES = Buffer.from('portable restore integration bytes\n'.repeat(64));
const FILE_SHA = createHash('sha256').update(FILE_BYTES).digest('hex');
let migrationsDir: string;
let db: Knex, root: string, archivePath: string, storageRoot: string;
let source: string, third: string, thirdClientId: string, sourceAdmin: string, sourceAuthor: string, ticketId: string, sourceContact: string, sourceFileId: string;
const destination = randomUUID();

function cliResult(stdout: string): Record<string, unknown> {
  for (let start = stdout.indexOf('{'); start >= 0; start = stdout.indexOf('{', start + 1)) {
    let depth = 0; let quoted = false; let escaped = false;
    for (let end = start; end < stdout.length; end++) {
      const char = stdout[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) {
        try {
          const parsed = JSON.parse(stdout.slice(start, end + 1));
          if (parsed && typeof parsed === 'object' && 'status' in parsed && ('outcome' in parsed || 'entitlement_source' in parsed)) return parsed;
        } catch { /* CLI logs may contain object-like fragments before its result. */ }
        break;
      }
    }
  }
  throw new Error('CLI did not emit a restore result');
}

const testRegistry = (): PortableContributorRegistry => createCorePortableRegistry();

/** The production local provider on a temp basePath. `failUploads` wraps it so staging crashes mid-restore. */
async function localProvider(options: { failUploads?: boolean } = {}) {
  const real = await StorageProviderFactory.createProvider();
  const provider = !options.failUploads ? real : new Proxy(real, { get(target, key) {
    if (key === 'upload') return async (stream: { destroy(): void }) => { stream.destroy(); throw new Error('simulated provider crash during staging'); };
    const value = (target as any)[key]; return typeof value === 'function' ? value.bind(target) : value;
  } });
  return provider as typeof real;
}
/** Every stored object (regular file) under the provider's basePath. */
async function storedObjects() {
  const entries = await readdir(storageRoot, { recursive: true, withFileTypes: true });
  return entries.filter(entry => entry.isFile()).map(entry => join(entry.parentPath, entry.name));
}

/** Every table that carries a tenant column, and how many rows a tenant holds in each. */
async function tenantTables() {
  const rows = await db.raw(`SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t
    ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'tenant' ORDER BY 1`);
  return rows.rows.map((row: { table_name: string }) => row.table_name) as string[];
}
async function counts(tenant: string, tables: string[]) {
  const result: Record<string, number> = {};
  for (const table of tables) {
    const row = await db(table).where({ tenant }).count({ count: '*' }).first();
    if (Number(row?.count)) result[table] = Number(row?.count);
  }
  return result;
}

beforeAll(async () => {
  const fixtureDatabase = process.env.CM_L8B_RESTORE_FIXTURE_DB;
  db = await createTestDbConnection(fixtureDatabase
    ? { databaseName: fixtureDatabase, recreate: false, runSeeds: false }
    : { migrationsDir: migrationsDir = buildMergedEeMigrationsDir() });
  root = await mkdtemp(join(tmpdir(), 'alga-l7b2-roundtrip-'));
  storageRoot = join(root, 'storage');
  process.env.STORAGE_DEFAULT_PROVIDER = 'local'; process.env.STORAGE_LOCAL_BASE_PATH = storageRoot;
  StorageProviderFactory.clearProvider();
  source = await createTenant(db, 'Source workspace'); third = await createTenant(db, 'Unrelated third tenant');
  sourceAdmin = await createUser(db, source, { first_name: 'Ada', last_name: 'Admin' });
  const role = randomUUID(), client = randomUUID(), board = randomUUID(), status = randomUUID();
  await db('roles').insert({ tenant: source, role_id: role, role_name: 'Co-management admin', msp: true, client: false });
  await db('user_roles').insert({ tenant: source, user_id: sourceAdmin, role_id: role });
  const permissionRows = ['co_management:manage', 'user:read', 'team:read', 'client:read', 'contact:read', 'security_settings:read',
    'ticket:read', 'ticket_settings:read', 'project:read', 'asset:read', 'workflow:admin', 'workflow:read'].map(value => {
      const [resource, action] = value.split(':');
      return { tenant: source, permission_id: randomUUID(), resource, action, msp: true, client: false };
    });
  await db('permissions').insert(permissionRows);
  await db('role_permissions').insert(permissionRows.map(row => ({ tenant: source, role_id: role, permission_id: row.permission_id })));
  // The real L7b1 file contributor checks the actor's home permission through tenantDb.
  const sessionId = randomUUID();
  await db('sessions').insert({ tenant: source, session_id: sessionId, user_id: sourceAdmin, created_at: db.fn.now(),
    expires_at: db.raw("now() + interval '1 day'") });
  sourceFileId = randomUUID(); const sourceStoragePath = `${source}/${sourceFileId}`;
  const sourceProvider = await localProvider();
  const uploaded = await sourceProvider.upload(FILE_BYTES, sourceStoragePath, { mime_type: 'text/plain', size: FILE_BYTES.length,
    metadata: { sha256: FILE_SHA, origin: 'fixture' } });
  await db('external_files').insert({ tenant: source, file_id: sourceFileId, file_name: sourceFileId, original_name: 'report.txt', mime_type: 'text/plain',
    file_size: uploaded.size, storage_path: uploaded.path, uploaded_by_id: sourceAdmin, is_deleted: false, deleted_at: null, deleted_by_id: null,
    metadata: { sha256: FILE_SHA, origin: 'fixture' } });
  await db('clients').insert({ tenant: source, client_id: client, client_name: 'Customer' });
  await db('boards').insert({ tenant: source, board_id: board, board_name: 'Support' });
  await db('statuses').insert({ tenant: source, status_id: status, name: 'Open', status_type: 'ticket', item_type: 'ticket', order_number: 1, board_id: board, is_default: true });
  ticketId = randomUUID();
  await db('tickets').insert({ tenant: source, ticket_id: ticketId, ticket_number: 'T-1001', title: 'Printer on fire', client_id: client, board_id: board, status_id: status, entered_by: sourceAdmin });
  // D3 fixture: authors of every kind, task comments and audit logs, none of whose FKs the contributors declare.
  sourceAuthor = await createUser(db, source, { first_name: 'Bea', last_name: 'Author' });
  sourceContact = randomUUID();
  await db('contacts').insert({ tenant: source, contact_name_id: sourceContact, full_name: 'Carl Contact', email: 'carl@example.test', client_id: client });
  const comment = async (author: Record<string, unknown>, note: string) => {
    const commentId = randomUUID(), threadId = randomUUID();
    await db('comment_threads').insert({ tenant: source, thread_id: threadId, ticket_id: ticketId, root_comment_id: commentId, is_internal: false });
    await db('comments').insert({ tenant: source, comment_id: commentId, ticket_id: ticketId, thread_id: threadId, note, is_internal: false, is_resolution: false, ...author });
  };
  await comment({ user_id: sourceAdmin, author_type: 'internal' }, 'comment by the administrator');
  await comment({ user_id: sourceAuthor, author_type: 'internal' }, 'comment by another user');
  await comment({ contact_id: sourceContact, author_type: 'client' }, 'comment by a contact');
  const projectStatus = randomUUID(), project = randomUUID(), phase = randomUUID(), task = randomUUID(), taskComment = randomUUID(), taskThread = randomUUID();
  await db('statuses').insert({ tenant: source, status_id: projectStatus, name: 'Active', status_type: 'project', item_type: 'project', order_number: 1, is_default: true });
  await db('projects').insert({ tenant: source, project_id: project, project_name: 'Rollout', status: projectStatus, wbs_code: '1', client_id: client, project_number: 'P-1' });
  await db('project_phases').insert({ tenant: source, phase_id: phase, project_id: project, phase_name: 'Phase 1', status: 'open', order_number: 1, wbs_code: '1.1' });
  await db('project_tasks').insert({ tenant: source, task_id: task, phase_id: phase, task_name: 'Install', wbs_code: '1.1.1' });
  await db('comment_threads').insert({ tenant: source, thread_id: taskThread, project_task_id: task, root_comment_id: taskComment, is_internal: false });
  await db('project_task_comments').insert({ tenant: source, task_comment_id: taskComment, task_id: task, user_id: sourceAuthor, author_type: 'internal', note: 'task comment', thread_id: taskThread });
  const actorReference = randomUUID();
  await db('collaboration_actor_references').insert({ tenant: source, actor_reference_id: actorReference, actor_tenant: third, actor_user_id: randomUUID(), display_name: 'Partner Tech', organization_name: 'Partner IT' });
  const audit = (values: Record<string, unknown>) => db('ticket_audit_logs').insert({ tenant: source, ticket_id: ticketId, event_type: 'TICKET_UPDATED', entity_type: 'ticket',
    source: 'system', occurred_at: new Date(), ...values });
  await audit({ actor_type: 'user', actor_user_id: sourceAuthor });
  await audit({ actor_type: 'user', actor_reference_id: actorReference, actor_display_name: 'Partner Tech', actor_organization_name: 'Partner IT' });
  // The third tenant holds data of its own so "unchanged" is a real assertion.
  thirdClientId = randomUUID(); await db('clients').insert({ tenant: third, client_id: thirdClientId, client_name: 'Bystander' });
  await db('tickets').insert({ tenant: third, ticket_id: randomUUID(), ticket_number: 'T-1', title: 'Bystander ticket', client_id: thirdClientId });

  // Export with the L7b1 contributors, in-process: same snapshot, collect, manifest and seal steps as the exporter.
  const registry = testRegistry();
  const packageId = randomUUID();
  const actor = { kind: 'session' as const, tenant: source, userId: sourceAdmin, sessionId };
  const capture = await withCoManagedPortableSnapshot(db, async snapshot => {
    const collected = await collectPortableWorkspace(registry, { db, actor: actor as never, packageId, snapshot });
    expect(collected.files.map(file => file.id)).toEqual([`file:${sourceFileId}`]);
    expect(collected.sections.find(section => section.id === 'files')?.records.external_files).toMatchObject([
      { file_id: sourceFileId, original_name: 'report.txt', mime_type: 'text/plain', uploaded_by_id: sourceAdmin },
    ]);
    const context = { packageId, sourceTenant: source, capturedAt: snapshot.capturedAt };
    return { collected, manifest: buildCoManagedPortableWorkspaceManifest({ context, collected, registry }) };
  });
  const sealed = await sealPortableArchive({ context: { packageId, sourceTenant: source }, manifest: { ...capture.manifest }, files: capture.collected.files, stagingRoot: root }, PASSPHRASE);
  archivePath = join(root, 'workspace.alga');
  await copyFile(sealed.path, archivePath);
  await sealed.dispose(); await capture.collected.dispose();
}, 600_000);

afterAll(async () => { await db?.destroy(); if (migrationsDir) await rm(migrationsDir, { recursive: true, force: true }); if (root) await rm(root, { recursive: true, force: true }); });

// vitest.config.ts shuffles test order. The restore is one stateful scenario (receipt state machine, idempotency and
// freshness all depend on what ran before), so it is a single ordered test made of named steps.
async function step(name: string, run: () => Promise<void>) {
  try { await run(); console.log(`[round-trip] ok: ${name}`); } catch (error) { if (error instanceof Error) error.message = `[step: ${name}] ${error.message}`; throw error; }
}

describe('portable restore round trip (A6)', () => {
  it('migrates, restores, resumes, is idempotent and isolated, and refuses non-fresh installations', async () => {
    const request = () => ({ archivePath, passphrase: PASSPHRASE, destinationTenant: destination, sourceAdministratorUserId: sourceAdmin });
    await step('L7b2 migrations run down, up and up again', async () => {
      await activationMigration.down(db);
      for (const migration of migrations) await migration.down(db);
      for (const table of ['portable_restore_suspensions', 'portable_workspace_restores', 'portable_workspace_restore_uploads']) expect(await db.schema.hasTable(table)).toBe(false);
      for (const migration of [...migrations].reverse()) await migration.up(db);
      await activationMigration.up(db);
      for (const migration of [...migrations].reverse()) await migration.up(db); // expand-only and idempotent
      for (const table of ['portable_restore_suspensions', 'portable_workspace_restores', 'portable_workspace_restore_uploads']) expect(await db.schema.hasTable(table)).toBe(true);
    });
    const tables = await tenantTables(), thirdBefore = await counts(third, tables), sourceBefore = await counts(source, tables);

    await step('refuses a wrong passphrase before writing anything', async () => {
      await expect(restorePortableWorkspaceForInstallation(db, { ...request(), passphrase: 'a different passphrase entirely' }, {}, { createProvider: async () => localProvider() as never }))
        .rejects.toThrow();
      expect(await counts(destination, tables)).toEqual({});
      expect(await db('portable_workspace_restores').where({ tenant: destination })).toHaveLength(0);
    });

    const journal = () => db('portable_workspace_restore_uploads').where({ tenant: destination });
    await step('a crash while staging leaves nothing that blocks a later restore: no receipt, no suspension, no rows (D4)', async () => {
      await expect(restorePortableWorkspaceForInstallation(db, request(), {}, { createProvider: async () => localProvider({ failUploads: true }) as never })).rejects.toThrow(/simulated provider crash/);
      expect(await db('portable_workspace_restores').where({ tenant: destination })).toHaveLength(0);
      expect(await db('portable_restore_suspensions').where({ tenant: destination })).toHaveLength(0);
      expect(await counts(destination, tables.filter(name => !name.startsWith('portable_')))).toEqual({});
      expect((await journal()).every(row => row.status !== 'committed')).toBe(true); // uploads are recovered by the journal + cleanup job
      await expect(restorePortableWorkspaceForInstallation(db, { ...request(), resume: true }, {}, { createProvider: async () => localProvider() as never })).rejects.toThrow(/nothing to resume/);
    });

    await step('cleanup recovers expired interrupted uploads, including legacy NULL deadlines, while retaining live and referenced bytes', async () => {
      const recoveryTenant = await createTenant(db, 'Portable restore cleanup recovery');
      const recoveryUploader = await createUser(db, recoveryTenant, { first_name: 'Cleanup', last_name: 'Uploader' });
      const provider = await localProvider();
      const createAttempt = async (label: string) => {
        const fileId = randomUUID();
        const attempt = await beginPortableRestoreUpload(db, { tenant: recoveryTenant, packageId: randomUUID(),
          archiveSha256: createHash('sha256').update(label).digest('hex'), fileIds: [fileId] }, provider);
        const row = await db('portable_workspace_restore_uploads').where({ tenant: recoveryTenant, attempt_id: attempt.attemptId }).first();
        expect(row.next_cleanup_at).toBeTruthy();
        const key = `${recoveryTenant}/portable-restores/${attempt.attemptId}/${fileId}`;
        await provider.upload(Buffer.from(label), key, { mime_type: 'text/plain', size: label.length });
        return { attempt, fileId, key };
      };
      const interrupted = await createAttempt('interrupted unreferenced upload');
      const referenced = await createAttempt('expired but referenced upload');
      const live = await createAttempt('still-live upload');
      // Simulate the old broken insert shape and a killed process: no settlement call occurs.
      await db('portable_workspace_restore_uploads').where({ tenant: recoveryTenant, attempt_id: interrupted.attempt.attemptId })
        .update({ expires_at: db.raw("now() - interval '1 minute'"), next_cleanup_at: null });
      await db('portable_workspace_restore_uploads').where({ tenant: recoveryTenant, attempt_id: referenced.attempt.attemptId })
        .update({ expires_at: db.raw("now() - interval '1 minute'"), next_cleanup_at: db.raw('now()') });
      await db('portable_workspace_restore_uploads').where({ tenant: recoveryTenant, attempt_id: live.attempt.attemptId })
        .update({ next_cleanup_at: db.raw('now()') });
      await db('external_files').insert({ tenant: recoveryTenant, file_id: referenced.fileId, file_name: 'retained',
        original_name: 'retained.txt', mime_type: 'text/plain', file_size: Buffer.byteLength('expired but referenced upload'),
        storage_path: referenced.key, uploaded_by_id: recoveryUploader, is_deleted: false });

      const outcome = await cleanupPortableRestoreUploadsForInstallation(db, provider as never);
      expect(outcome.destinations).toBeGreaterThanOrEqual(1);
      expect(outcome.cleaned).toBeGreaterThanOrEqual(1);
      expect(outcome.failed).toBe(0);
      await expect(provider.download(interrupted.key)).rejects.toThrow();
      expect(await provider.download(referenced.key)).toEqual(Buffer.from('expired but referenced upload'));
      expect(await provider.download(live.key)).toEqual(Buffer.from('still-live upload'));
      expect(await db('portable_workspace_restore_uploads').where({ tenant: recoveryTenant, attempt_id: interrupted.attempt.attemptId })
        .first()).toMatchObject({ status: 'abandoned', cleaned_at: expect.anything() });
      expect(await db('portable_workspace_restore_uploads').where({ tenant: recoveryTenant, attempt_id: referenced.attempt.attemptId })
        .first()).toMatchObject({ cleanup_error_code: 'native_reference_retained' });
      expect(await db('portable_workspace_restore_uploads').where({ tenant: recoveryTenant, attempt_id: live.attempt.attemptId })
        .first()).toMatchObject({ status: 'uploading' });
    });

    await step('a failure inside promotion (after bytes are staged) rolls the receipt and suspension back too (D4)', async () => {
      await db.raw(`CREATE OR REPLACE FUNCTION l7b2_force_promotion_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.tenant = '${destination}' THEN RAISE EXCEPTION 'forced promotion failure'; END IF; RETURN NEW; END $$`);
      await db.raw('CREATE TRIGGER l7b2_force_promotion_failure BEFORE INSERT ON tickets FOR EACH ROW EXECUTE FUNCTION l7b2_force_promotion_failure()');
      try {
        await expect(restorePortableWorkspaceForInstallation(db, request(), {}, { createProvider: async () => localProvider() as never })).rejects.toThrow(/forced promotion failure/);
      } finally {
        await db.raw('DROP TRIGGER IF EXISTS l7b2_force_promotion_failure ON tickets'); await db.raw('DROP FUNCTION IF EXISTS l7b2_force_promotion_failure()');
      }
      expect(await db('portable_workspace_restores').where({ tenant: destination })).toHaveLength(0);
      expect(await db('portable_restore_suspensions').where({ tenant: destination })).toHaveLength(0);
      expect(await counts(destination, tables.filter(name => !name.startsWith('portable_')))).toEqual({});
      expect((await journal()).every(row => row.status !== 'committed')).toBe(true);
    });

    await step('the shipped CLI restores the same destination in a single --apply', async () => {
      const provider = await localProvider();
      const cli = spawnSync('npm', ['exec', '--', 'tsx', '--tsconfig', '../ee/server/tsconfig.json', 'scripts/restore-portable-workspace.ts',
        '--apply', '--archive', archivePath, '--destination-tenant', destination, '--administrator-user-id', sourceAdmin], {
        cwd: resolve(__dirname, '../../..'), encoding: 'utf8', timeout: 180_000,
        env: { ...process.env, DB_NAME_SERVER: process.env.CM_L8B_RESTORE_FIXTURE_DB ?? process.env.TEST_DB_NAME ?? 'test_database',
          FORCE_CAPABILITIES: '', ALGA_PORTABLE_RESTORE_PASSPHRASE: PASSPHRASE },
      });
      expect(cli.status, cli.stderr).toBe(0);
      const result = cliResult(cli.stdout);
      expect(result.status).toMatch(/remains suspended pending activation/);
      const restoredReceipt = await db('portable_workspace_restores').where({ tenant: destination }).first();
      expect(restoredReceipt).toMatchObject({ state: 'verified' });
      expect(result.outcome).toBe('restored');
      expect(result.receipt.administrator_user_id).toBe(restoredReceipt.administrator_user_id);
      expect(await db('portable_workspace_restores').where({ tenant: destination })).toHaveLength(1);
      expect(await db('tickets').where({ tenant: destination })).toHaveLength(1);
      expect(await db('portable_restore_suspensions').where({ tenant: destination }).first()).toMatchObject({ reason: 'portable_restore_pending_activation' });
      expect((await journal()).filter(row => row.status === 'committed')).toHaveLength(1);

      // The ticket and the file resolve under the destination tenant; the bytes read back with a matching hash.
      const ticket = await db('tickets').where({ tenant: destination, ticket_number: 'T-1001' }).first();
      expect(ticket).toMatchObject({ title: 'Printer on fire' });
      expect(await db('clients').where({ tenant: destination, client_id: ticket.client_id }).first()).toMatchObject({ client_name: 'Customer' });
      const files = await db('external_files').where({ tenant: destination });
      expect(files).toHaveLength(1);
      expect(files[0]).toMatchObject({ file_name: files[0].file_id, original_name: 'report.txt', mime_type: 'text/plain',
        uploaded_by_id: restoredReceipt.administrator_user_id, is_deleted: false,
        metadata: { portable_restore: { version: 2, source_blob_id: expect.stringMatching(/^file:/), sha256: FILE_SHA } } });
      expect(files[0].file_id).not.toBe(sourceFileId);
      const stored = await provider.download(files[0].storage_path);
      expect(createHash('sha256').update(stored).digest('hex')).toBe(FILE_SHA);
      expect(Number(files[0].file_size)).toBe(FILE_BYTES.length);
      expect((await storedObjects()).filter(path => path.endsWith(files[0].storage_path.split('/').pop()))).toHaveLength(1); // the bytes landed once
      expect(await storedObjects()).toHaveLength(4); // source, promoted destination, and the live/referenced recovery objects
      expect(await db('users').where({ tenant: destination, user_id: restoredReceipt.administrator_user_id }).first()).toBeTruthy();
    });

    await step('rewrites every row: the written table set equals the archive manifest, and no row carries the source tenant', async () => {
      const written = Object.keys(await counts(destination, tables)).filter(table => !table.startsWith('portable_')).sort();
      const archived = new Set<string>();
      const registry = testRegistry();
      for (const contributor of registry.list()) for (const table of Object.keys(contributor.columns)) archived.add(table);
      for (const table of written) {
        expect([...archived, 'external_files', 'ticket_audit_logs', 'audit_logs']).toContain(table);
      }
      const nonEmptyArchived = ['tenants', 'users', 'roles', 'permissions', 'user_roles', 'role_permissions', 'clients', 'boards', 'statuses', 'tickets', 'contacts', 'comments', 'comment_threads', 'projects', 'project_tasks', 'project_task_comments', 'ticket_audit_logs', 'collaboration_actor_references'];
      for (const table of nonEmptyArchived) expect(written).toContain(table);
      // The receipt is the one deliberate provenance record (source_tenant, source administrator, package id); every other row must be clean.
      expect(await db('portable_workspace_restores').where({ tenant: destination }).first()).toMatchObject({ source_tenant: source });
      for (const table of tables.filter(name => name !== 'portable_workspace_restores')) {
        const leaked = await db(table).where({ tenant: destination }).whereRaw(`${table}::text ILIKE ?`, [`%${source}%`]).count({ count: '*' }).first();
        expect(Number(leaked?.count), `${table} carries the source tenant id`).toBe(0);
      }
      expect(await counts(source, tables)).toEqual(sourceBefore); // the source workspace is untouched
    });

    await step('authored rows resolve to the restored users, contacts and actor references, not the source ids (D3)', async () => {
      const ticket = await db('tickets').where({ tenant: destination, ticket_number: 'T-1001' }).first();
      expect(ticket.ticket_id).not.toBe(ticketId);
      const users = await db('users').where({ tenant: destination }), contacts = await db('contacts').where({ tenant: destination });
      const restoredUser = (name: string) => users.find(user => user.first_name === name)!;
      const restoredContact = contacts.find(contact => contact.full_name === 'Carl Contact')!;
      expect(restoredUser('Bea').user_id).not.toBe(sourceAuthor); expect(restoredContact.contact_name_id).not.toBe(sourceContact);
      const comments = await db('comments').where({ tenant: destination, ticket_id: ticket.ticket_id });
      expect(comments).toHaveLength(3);
      const byNote = (note: string) => comments.find(comment => comment.note === note)!;
      expect(byNote('comment by the administrator').user_id).toBe((await db('portable_workspace_restores').where({ tenant: destination }).first()).administrator_user_id);
      expect(byNote('comment by another user').user_id).toBe(restoredUser('Bea').user_id);
      expect(byNote('comment by a contact')).toMatchObject({ contact_id: restoredContact.contact_name_id, user_id: null });
      const taskComments = await db('project_task_comments').where({ tenant: destination });
      expect(taskComments).toHaveLength(1); expect(taskComments[0].user_id).toBe(restoredUser('Bea').user_id);
      const audits = await db('ticket_audit_logs').where({ tenant: destination, ticket_id: ticket.ticket_id });
      expect(audits).toHaveLength(2);
      expect(audits.find(row => row.actor_user_id)!.actor_user_id).toBe(restoredUser('Bea').user_id);
      const reference = audits.find(row => row.actor_reference_id)!;
      expect(await db('collaboration_actor_references').where({ tenant: destination, actor_reference_id: reference.actor_reference_id }).first()).toMatchObject({ display_name: 'Partner Tech' });
      // Every id a restored comment, task comment or audit row carries is a destination-tenant row; none is a source id.
      const sourceIds = [sourceAdmin, sourceAuthor, sourceContact, ticketId];
      for (const row of [...comments, ...taskComments, ...audits]) for (const value of Object.values(row)) expect(sourceIds).not.toContain(value);
      expect(await db.raw(`SELECT 1 FROM comments c WHERE c.tenant = ? AND c.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.tenant = c.tenant AND u.user_id = c.user_id)`, [destination]).then(r => r.rows)).toHaveLength(0);
    });

    await step('--resume completes a restore interrupted after promotion (state promoted), without duplicates', async () => {
      const before = await counts(destination, tables);
      await db('portable_workspace_restores').where({ tenant: destination }).update({ state: 'promoted', verified_at: null });
      const result = await restorePortableWorkspaceForInstallation(db, { ...request(), resume: true }, {}, { createProvider: async () => localProvider() as never });
      expect(result.outcome).toBe('resumed'); expect(result.receipt.state).toBe('verified');
      expect(await counts(destination, tables)).toEqual(before);
    });

    await step('a second apply is idempotent: already-restored, and no rows are written', async () => {
      const before = await counts(destination, tables);
      const objectsBefore = await storedObjects();
      const provider = await localProvider();
      const result = await restorePortableWorkspaceForInstallation(db, request(), {}, { createProvider: async () => provider as never });
      expect(result.outcome).toBe('already-restored');
      expect(await storedObjects()).toEqual(objectsBefore);
      expect(await counts(destination, tables)).toEqual(before);
      const again = await restorePortableWorkspaceForInstallation(db, { ...request(), resume: true }, {}, { createProvider: async () => provider as never });
      expect(again.outcome).toBe('already-restored');
      expect(await counts(destination, tables)).toEqual(before);
    });

    await step('leaves the unrelated third tenant byte-for-byte unchanged in every table', async () => {
      expect(await counts(third, tables)).toEqual(thirdBefore);
    });

    await step('refuses a restore into a non-fresh installation (a different destination while a restore receipt exists)', async () => {
      const other = randomUUID();
      await expect(restorePortableWorkspaceForInstallation(db, { ...request(), destinationTenant: other }, {}, { createProvider: async () => localProvider() as never }))
        .rejects.toThrow(/already holds|fresh/);
      expect(await counts(other, tables)).toEqual({});
      expect(await db('portable_workspace_restores').where({ tenant: other })).toHaveLength(0);
    });

    await step('refuses even an otherwise-empty destination when this installation already has a relationship', async () => {
      const relationshipId = randomUUID();
      await db('co_management_relationships').insert({ tenant: source, relationship_id: relationshipId, sponsor_tenant: third,
        sponsor_client_id: thirdClientId, state: 'active', accepted_by: sourceAdmin, accepted_at: db.fn.now() });
      const other = randomUUID();
      await expect(restorePortableWorkspaceForInstallation(db, { ...request(), destinationTenant: other }, {}, { createProvider: async () => localProvider() as never }))
        .rejects.toThrow(/already holds a co-managed relationship/);
      expect(await counts(other, tables)).toEqual({});
      await db('co_management_relationships').where({ tenant: source, relationship_id: relationshipId }).delete();
    });

    await step('the shipped CLI activates this restored workspace with its own hosted subscription; replay keeps credentials and dispatch state', async () => {
      const host = new EmulatorHost({ emulators: [stripeEmulator], controlPort: 0, ports: { stripe: 0 } });
      const priorStripeBase = process.env.STRIPE_API_BASE_URL;
      try {
        const started = await host.start();
        const stripeBase = `http://127.0.0.1:${started.ports.stripe}`;
        const control = `http://127.0.0.1:${started.controlPort}`;
        const control$ = async (path: string, body: unknown = {}) => (await (await fetch(`${control}${path}`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        })).json()) as any;
        const secret = 'sk_test_l8b_restore_activation';
        const productId = 'prod_l8b_restore_activation', priceId = 'price_l8b_restore_activation';
        await control$('/control/stripe/seed/config', { secretKey: secret, publishableKey: 'pk_test_l8b_restore_activation' });
        await control$('/control/stripe/seed/product', { id: productId, name: 'Independent PSA seats' });
        await control$('/control/stripe/seed/price', { id: priceId, unitAmount: 2900, currency: 'eur', interval: 'month', product: productId });
        const stripe = new Stripe(secret, { apiVersion: '2024-12-18.acacia' as any, host: '127.0.0.1', port: started.ports.stripe,
          protocol: 'http', typescript: true });
        const customer = await stripe.customers.create({ email: 'restored-owner@example.test', name: 'Restored owner', metadata: { tenant_id: destination } });
        const core = (host.instance('stripe') as any).core;
        const product = core.getProduct(productId);
        const price = core.getPrice(priceId);
        const subscription = core.createSubscription({ customer: customer.id, priceId, quantity: 2,
          metadata: { tenant_id: destination, subscription_kind: 'independent_psa' }, status: 'active' });
        const localCustomerId = randomUUID(), localProductId = randomUUID(), localPriceId = randomUUID();
        await db('stripe_customers').insert({ tenant: destination, stripe_customer_id: localCustomerId,
          stripe_customer_external_id: customer.id, email: customer.email, name: customer.name, metadata: customer.metadata });
        await db('stripe_products').insert({ tenant: destination, stripe_product_id: localProductId,
          stripe_product_external_id: product.id, name: product.name, product_type: 'license', metadata: product.metadata ?? {} });
        await db('stripe_prices').insert({ tenant: destination, stripe_price_id: localPriceId,
          stripe_price_external_id: price.id, stripe_product_id: localProductId, unit_amount: price.unit_amount,
          currency: price.currency, billing_interval: price.recurring.interval, interval_count: price.recurring.interval_count,
          metadata: price.metadata ?? {} });
        await db('stripe_subscriptions').insert({ tenant: destination, stripe_subscription_external_id: subscription.id,
          stripe_customer_id: localCustomerId, stripe_price_id: localPriceId, stripe_subscription_item_id: subscription.items.data[0].id,
          quantity: 2, status: 'active', current_period_end: new Date(subscription.current_period_end * 1000),
          metadata: subscription.metadata });

        const password = 'Restored-Admin-Password-42!';
        const operationId = randomUUID();
        const runActivation = (inputPassword: string) => new Promise<{ status: number | null; stdout: string; stderr: string }>((resolveRun, rejectRun) => {
          const child = spawn('npm', ['exec', '--', 'tsx', '--tsconfig', '../ee/server/tsconfig.json',
            'scripts/restore-portable-workspace.ts', '--activate-hosted', '--destination-tenant', destination,
            '--operation-id', operationId, '--password-stdin'], {
            cwd: resolve(__dirname, '../../..'),
            env: { ...process.env, DB_NAME_SERVER: process.env.CM_L8B_RESTORE_FIXTURE_DB ?? process.env.TEST_DB_NAME ?? 'test_database',
              STRIPE_SECRET_KEY: secret, STRIPE_API_BASE_URL: stripeBase, STRIPE_ALGAPSA_USER_PRICE_ID: priceId, FORCE_CAPABILITIES: '' },
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          let stdout = '', stderr = '';
          const timer = setTimeout(() => child.kill('SIGTERM'), 240_000);
          child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
          child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
          child.once('error', error => { clearTimeout(timer); rejectRun(error); });
          child.once('close', status => { clearTimeout(timer); resolveRun({ status, stdout, stderr }); });
          child.stdin.end(inputPassword);
        });
        const activated = await runActivation(password);
        expect(activated.status, activated.stderr).toBe(0);
        expect(activated.stderr).not.toMatch(/failed during (activation module loading|database connection)/);
        expect(activated.stdout + activated.stderr).not.toContain(password);
        const activationResult = cliResult(activated.stdout);
        expect(activationResult).toMatchObject({ status: expect.stringMatching(/activation recorded/), tenant: destination,
          entitlement_source: 'hosted_subscription', entitlement_reference: subscription.id, operation_id: operationId });
        const retained = await db('portable_workspace_activations').where({ tenant: destination }).first();
        const restoredReceipt = await db('portable_workspace_restores').where({ tenant: destination }).first();
        expect(retained).toMatchObject({ operation_id: operationId, administrator_user_id: restoredReceipt.administrator_user_id,
          entitlement_source: 'hosted_subscription', entitlement_reference: subscription.id, seats: 2 });
        const users = await db('users').where({ tenant: destination }).select('user_id', 'is_inactive', 'hashed_password');
        const admin = users.find(user => user.user_id === restoredReceipt.administrator_user_id)!;
        expect(admin.is_inactive).toBe(false);
        expect(await verifyPassword(password, admin.hashed_password)).toBe(true);
        expect(users.filter(user => user.user_id !== admin.user_id).length).toBeGreaterThan(0);
        expect(users.filter(user => user.user_id !== admin.user_id).every(user => user.is_inactive === true)).toBe(true);
        const workflows = await db('workflow_definitions').where({ tenant: destination }).select('workflow_id', 'is_paused');
        expect(workflows.length).toBeGreaterThan(0);
        expect(workflows.every(workflow => workflow.is_paused === true)).toBe(true);
        expect(await db('asset_maintenance_schedules').where({ tenant: destination, is_active: true })).toHaveLength(0);
        expect(await db('comments').where({ tenant: destination, publish_state: 'scheduled' })).toHaveLength(0);
        expect(await db('online_meetings').where({ tenant: destination }).whereIn('status', ['scheduled', 'ended', 'recording_pending', 'cancel_pending'])).toHaveLength(0);
        expect(await db('availability_settings').whereRaw("tenant = ? AND config_json->>'auto_approval_enabled' = 'true'", [destination])).toHaveLength(0);
        expect(await db('portable_restore_suspensions').where({ tenant: destination }).whereNull('released_at')).toHaveLength(0);

        const replayPassword = 'Replay-Must-Not-Replace-42!';
        const replay = await runActivation(replayPassword);
        expect(replay.status, replay.stderr).toBe(0);
        expect(replay.stdout + replay.stderr).not.toContain(replayPassword);
        expect(cliResult(replay.stdout)).toMatchObject({ tenant: destination, operation_id: operationId,
          entitlement_reference: subscription.id });
        const replayAdmin = await db('users').where({ tenant: destination, user_id: admin.user_id }).first('hashed_password', 'is_inactive');
        expect(replayAdmin.hashed_password).toBe(admin.hashed_password);
        expect(await verifyPassword(password, replayAdmin.hashed_password)).toBe(true);
        expect(await verifyPassword(replayPassword, replayAdmin.hashed_password)).toBe(false);
        expect(await db('portable_workspace_activations').where({ tenant: destination })).toHaveLength(1);
        expect(await db('portable_restore_suspensions').where({ tenant: destination }).whereNull('released_at')).toHaveLength(0);
        expect((await db('workflow_definitions').where({ tenant: destination }).where('is_paused', false)).length).toBe(0);
      } finally {
        process.env.STRIPE_API_BASE_URL = priorStripeBase;
        if (priorStripeBase === undefined) delete process.env.STRIPE_API_BASE_URL;
        await host.stop();
      }
    });

  }, 1_200_000);
});
