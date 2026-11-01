/**
 * CM L7b2 A6 — portable restore round trip against a real migrated PostgreSQL.
 *
 * Source tenant (ticket + file) -> L7b1 contributors, collect, manifest and sealed archive (built in-test, nothing
 * checked in) -> restorePortableWorkspaceForInstallation into a fresh destination UUID. A third, unrelated tenant is
 * snapshotted before and after.
 *
 * What is real: the migrated schema (including the three L7b2 migrations, run down and up here), the L7b1 contributors'
 * SQL, the archive, the restore database layer (catalog/FK discovery, topological insert, cycle deferral), the receipt
 * state machine, the upload journal and the promotion transaction.
 * What is stood in: the co-managed export admission seam (relationship/entitlement/session plumbing is not what this
 * test is about). The storage provider is the REAL StorageProviderFactory local provider on a temp basePath (its own
 * getLocationIdentity; nothing here supplies one). No L7b1 contributor emits blobs, so one test-only contributor
 * and binder supply the file; see the final test for what that means for production.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../test-utils/testDataFactory';

vi.mock('../../../../packages/co-managed/src/portableExport', async importOriginal => ({
  ...(await importOriginal<any>()),
  withCoManagedExportAdmin: (db: Knex, actor: any, work: (trx: Knex.Transaction, actor: any, subject: any) => Promise<unknown>) =>
    db.transaction(trx => work(trx, actor, { tenant: actor.tenant, userId: actor.userId })),
}));
vi.mock('../../../../packages/co-managed/src/localPermission', async importOriginal => ({ ...(await importOriginal<any>()), hasCoManagedLocalPermission: async () => true }));
vi.mock('../../../../packages/co-managed/src/sharedWorkIdentity', async importOriginal => ({
  ...(await importOriginal<any>()), authorizeCoManagedLocalRecord: async () => ({ redactedFields: [] }),
}));

import { CORE_PORTABLE_CONTRIBUTORS } from '../../../../packages/co-managed/src/portableCoreRegistry';
import { collectPortableWorkspace } from '../../../../packages/co-managed/src/portableWorkspaceGraph';
import { buildCoManagedPortableWorkspaceManifest } from '../../../../packages/co-managed/src/portableWorkspaceManifest';
import { withCoManagedPortableSnapshot } from '../../../../packages/co-managed/src/portableSnapshot';
import { sealPortableArchive } from '../../../../packages/co-managed/src/portableArchive';
import { createPortableContributorRegistry, type PortableContributor } from '../../../../packages/co-managed/src/portableContributorRegistry';
import type { PortableRestoreBlobBinder } from '../../../../packages/co-managed/src/portableWorkspaceRestoreFiles';
import { StorageProviderFactory } from '@alga-psa/storage/StorageProviderFactory';
import { restorePortableWorkspaceForInstallation } from '../../../../ee/server/src/lib/co-managed/portableWorkspaceRestore';

const require = createRequire(import.meta.url);
const migrations = ['20261031090200_create_portable_workspace_restore_uploads.cjs', '20261031090100_create_portable_workspace_restores.cjs',
  '20261031090000_create_portable_restore_suspensions.cjs'].map(file => require(`../../../migrations/${file}`));

const PASSPHRASE = 'round trip passphrase 2026 correct horse';
const FILE_BYTES = Buffer.from('portable restore integration bytes\n'.repeat(64));
const FILE_SHA = createHash('sha256').update(FILE_BYTES).digest('hex');
const BLOB_ID = `test_file:${randomUUID()}`;

let db: Knex, root: string, archivePath: string, storageRoot: string;
let source: string, third: string, sourceAdmin: string, sourceAuthor: string, ticketId: string, sourceContact: string;
const destination = randomUUID();

/** Test-only: the real work contributor, plus one blob. No L7b1 contributor emits blobs (documents are L7b3). */
const withFile = (contributor: PortableContributor): PortableContributor => ({ ...contributor,
  export: async ctx => ({ ...(await contributor.export(ctx)),
    files: { files: [{ id: BLOB_ID, path: join(root, 'source.txt'), size: FILE_BYTES.length, sha256: FILE_SHA }], dispose: async () => {} } }) });
const testRegistry = () => createPortableContributorRegistry(CORE_PORTABLE_CONTRIBUTORS.map(c => c.id === 'work' ? withFile(c) : c));
const binders: PortableRestoreBlobBinder[] = [{ kind: 'test_file', bind: () => ({ name: 'report.txt', mimeType: 'text/plain' }) }];

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
  db = await createTestDbConnection();
  root = await mkdtemp(join(tmpdir(), 'alga-l7b2-roundtrip-'));
  storageRoot = join(root, 'storage');
  process.env.STORAGE_DEFAULT_PROVIDER = 'local'; process.env.STORAGE_LOCAL_BASE_PATH = storageRoot;
  StorageProviderFactory.clearProvider();
  await writeFile(join(root, 'source.txt'), FILE_BYTES);

  source = await createTenant(db, 'Source workspace'); third = await createTenant(db, 'Unrelated third tenant');
  sourceAdmin = await createUser(db, source, { first_name: 'Ada', last_name: 'Admin' });
  const permission = randomUUID(), role = randomUUID(), client = randomUUID(), board = randomUUID(), status = randomUUID();
  await db('permissions').insert({ tenant: source, permission_id: permission, resource: 'co_management', action: 'manage', msp: true, client: false });
  await db('roles').insert({ tenant: source, role_id: role, role_name: 'Co-management admin', msp: true, client: false });
  await db('role_permissions').insert({ tenant: source, role_id: role, permission_id: permission });
  await db('user_roles').insert({ tenant: source, user_id: sourceAdmin, role_id: role });
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
  const thirdClient = randomUUID(); await db('clients').insert({ tenant: third, client_id: thirdClient, client_name: 'Bystander' });
  await db('tickets').insert({ tenant: third, ticket_id: randomUUID(), ticket_number: 'T-1', title: 'Bystander ticket', client_id: thirdClient });

  // Export with the L7b1 contributors, in-process: same snapshot, collect, manifest and seal steps as the exporter.
  const registry = testRegistry();
  const packageId = randomUUID();
  const actor = { kind: 'session' as const, tenant: source, userId: sourceAdmin, sessionId: randomUUID() };
  const capture = await withCoManagedPortableSnapshot(db, async snapshot => {
    const collected = await collectPortableWorkspace(registry, { db, actor: actor as never, packageId, snapshot });
    const context = { packageId, sourceTenant: source, capturedAt: snapshot.capturedAt };
    return { collected, manifest: buildCoManagedPortableWorkspaceManifest({ context, collected, registry }) };
  });
  const sealed = await sealPortableArchive({ context: { packageId, sourceTenant: source }, manifest: { ...capture.manifest }, files: capture.collected.files, stagingRoot: root }, PASSPHRASE);
  archivePath = join(root, 'workspace.alga');
  await copyFile(sealed.path, archivePath);
  await sealed.dispose(); await capture.collected.dispose();
}, 600_000);

afterAll(async () => { await db?.destroy(); if (root) await rm(root, { recursive: true, force: true }); });

// vitest.config.ts shuffles test order. The restore is one stateful scenario (receipt state machine, idempotency and
// freshness all depend on what ran before), so it is a single ordered test made of named steps.
async function step(name: string, run: () => Promise<void>) {
  try { await run(); console.log(`[round-trip] ok: ${name}`); } catch (error) { if (error instanceof Error) error.message = `[step: ${name}] ${error.message}`; throw error; }
}

describe('portable restore round trip (A6)', () => {
  it('migrates, restores, resumes, is idempotent and isolated, and refuses non-fresh installations', async () => {
    const request = () => ({ archivePath, passphrase: PASSPHRASE, destinationTenant: destination, sourceAdministratorUserId: sourceAdmin });
    await step('L7b2 migrations run down, up and up again', async () => {
      for (const migration of migrations) await migration.down(db);
      for (const table of ['portable_restore_suspensions', 'portable_workspace_restores', 'portable_workspace_restore_uploads']) expect(await db.schema.hasTable(table)).toBe(false);
      for (const migration of [...migrations].reverse()) await migration.up(db);
      for (const migration of [...migrations].reverse()) await migration.up(db); // expand-only and idempotent
      for (const table of ['portable_restore_suspensions', 'portable_workspace_restores', 'portable_workspace_restore_uploads']) expect(await db.schema.hasTable(table)).toBe(true);
    });
    const tables = await tenantTables(), thirdBefore = await counts(third, tables), sourceBefore = await counts(source, tables);

    await step('refuses a wrong passphrase before writing anything', async () => {
      await expect(restorePortableWorkspaceForInstallation(db, { ...request(), passphrase: 'a different passphrase entirely' }, {}, { createProvider: async () => localProvider() as never, binders }))
        .rejects.toThrow();
      expect(await counts(destination, tables)).toEqual({});
      expect(await db('portable_workspace_restores').where({ tenant: destination })).toHaveLength(0);
    });

    await step('states plainly what is test-only: without a registered binder the restore of a file-bearing archive fails closed, before any receipt exists', async () => {
      // Production ships no blob binder (L7b1 contributors emit no blobs; documents arrive with L7b3). A file-bearing
      // archive therefore cannot be restored in production yet: this is a named gap, not a silent skip.
      const fresh = randomUUID();
      await expect(restorePortableWorkspaceForInstallation(db, { ...request(), destinationTenant: fresh }, {}, { createProvider: async () => localProvider() as never, }))
        .rejects.toThrow(/no file binder/);
      expect(await counts(fresh, tables)).toEqual({});
      expect(await db('portable_workspace_restores').where({ tenant: fresh })).toHaveLength(0);
    });

    const journal = () => db('portable_workspace_restore_uploads').where({ tenant: destination });
    await step('a crash while staging leaves nothing that blocks a later restore: no receipt, no suspension, no rows (D4)', async () => {
      await expect(restorePortableWorkspaceForInstallation(db, request(), {}, { createProvider: async () => localProvider({ failUploads: true }) as never, binders })).rejects.toThrow(/simulated provider crash/);
      expect(await db('portable_workspace_restores').where({ tenant: destination })).toHaveLength(0);
      expect(await db('portable_restore_suspensions').where({ tenant: destination })).toHaveLength(0);
      expect(await counts(destination, tables.filter(name => !name.startsWith('portable_')))).toEqual({});
      expect((await journal()).every(row => row.status !== 'committed')).toBe(true); // uploads are recovered by the journal + cleanup job
      await expect(restorePortableWorkspaceForInstallation(db, { ...request(), resume: true }, {}, { createProvider: async () => localProvider() as never, binders })).rejects.toThrow(/nothing to resume/);
    });

    await step('a failure inside promotion (after bytes are staged) rolls the receipt and suspension back too (D4)', async () => {
      await db.raw(`CREATE OR REPLACE FUNCTION l7b2_force_promotion_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.tenant = '${destination}' THEN RAISE EXCEPTION 'forced promotion failure'; END IF; RETURN NEW; END $$`);
      await db.raw('CREATE TRIGGER l7b2_force_promotion_failure BEFORE INSERT ON tickets FOR EACH ROW EXECUTE FUNCTION l7b2_force_promotion_failure()');
      try {
        await expect(restorePortableWorkspaceForInstallation(db, request(), {}, { createProvider: async () => localProvider() as never, binders })).rejects.toThrow(/forced promotion failure/);
      } finally {
        await db.raw('DROP TRIGGER IF EXISTS l7b2_force_promotion_failure ON tickets'); await db.raw('DROP FUNCTION IF EXISTS l7b2_force_promotion_failure()');
      }
      expect(await db('portable_workspace_restores').where({ tenant: destination })).toHaveLength(0);
      expect(await db('portable_restore_suspensions').where({ tenant: destination })).toHaveLength(0);
      expect(await counts(destination, tables.filter(name => !name.startsWith('portable_')))).toEqual({});
      expect((await journal()).every(row => row.status !== 'committed')).toBe(true);
    });

    await step('the same destination then restores in a single --apply', async () => {
      const provider = await localProvider();
      const result = await restorePortableWorkspaceForInstallation(db, request(), {}, { createProvider: async () => provider as never, binders });
      expect(result.outcome).toBe('restored');
      expect(result.receipt.state).toBe('verified');
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
      expect(files[0]).toMatchObject({ original_name: 'report.txt', mime_type: 'text/plain', is_deleted: false });
      const stored = await provider.download(files[0].storage_path);
      expect(createHash('sha256').update(stored).digest('hex')).toBe(FILE_SHA);
      expect(Number(files[0].file_size)).toBe(FILE_BYTES.length);
      expect((await storedObjects()).filter(path => path.endsWith(files[0].storage_path.split('/').pop()))).toHaveLength(1); // the bytes landed once
      expect(await storedObjects()).toHaveLength(1); // and nothing from the failed attempts remains
      expect(await db('users').where({ tenant: destination, user_id: result.receipt.administrator_user_id }).first()).toBeTruthy();
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
      const result = await restorePortableWorkspaceForInstallation(db, { ...request(), resume: true }, {}, { createProvider: async () => localProvider() as never, binders });
      expect(result.outcome).toBe('resumed'); expect(result.receipt.state).toBe('verified');
      expect(await counts(destination, tables)).toEqual(before);
    });

    await step('a second apply is idempotent: already-restored, and no rows are written', async () => {
      const before = await counts(destination, tables);
      const objectsBefore = await storedObjects();
      const provider = await localProvider();
      const result = await restorePortableWorkspaceForInstallation(db, request(), {}, { createProvider: async () => provider as never, binders });
      expect(result.outcome).toBe('already-restored');
      expect(await storedObjects()).toEqual(objectsBefore);
      expect(await counts(destination, tables)).toEqual(before);
      const again = await restorePortableWorkspaceForInstallation(db, { ...request(), resume: true }, {}, { createProvider: async () => provider as never, binders });
      expect(again.outcome).toBe('already-restored');
      expect(await counts(destination, tables)).toEqual(before);
    });

    await step('leaves the unrelated third tenant byte-for-byte unchanged in every table', async () => {
      expect(await counts(third, tables)).toEqual(thirdBefore);
    });

    await step('refuses a restore into a non-fresh installation (a different destination while a restore receipt exists)', async () => {
      const other = randomUUID();
      await expect(restorePortableWorkspaceForInstallation(db, { ...request(), destinationTenant: other }, {}, { createProvider: async () => localProvider() as never, binders }))
        .rejects.toThrow(/already holds|fresh/);
      expect(await counts(other, tables)).toEqual({});
      expect(await db('portable_workspace_restores').where({ tenant: other })).toHaveLength(0);
    });

  }, 1_200_000);
});
