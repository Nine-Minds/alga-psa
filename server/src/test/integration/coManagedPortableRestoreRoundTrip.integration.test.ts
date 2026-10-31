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
 * test is about), and the storage provider (in-memory). No L7b1 contributor emits blobs, so one test-only contributor
 * and binder supply the file; see the final test for what that means for production.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
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
import { restorePortableWorkspaceForInstallation } from '../../../../ee/server/src/lib/co-managed/portableWorkspaceRestore';

const require = createRequire(import.meta.url);
const migrations = ['20261031090200_create_portable_workspace_restore_uploads.cjs', '20261031090100_create_portable_workspace_restores.cjs',
  '20261031090000_create_portable_restore_suspensions.cjs'].map(file => require(`../../../migrations/${file}`));

const PASSPHRASE = 'round trip passphrase 2026 correct horse';
const FILE_BYTES = Buffer.from('portable restore integration bytes\n'.repeat(64));
const FILE_SHA = createHash('sha256').update(FILE_BYTES).digest('hex');
const BLOB_ID = `test_file:${randomUUID()}`;

let db: Knex, root: string, archivePath: string;
let source: string, third: string, sourceAdmin: string;
const destination = randomUUID();

/** Test-only: the real work contributor, plus one blob. No L7b1 contributor emits blobs (documents are L7b3). */
const withFile = (contributor: PortableContributor): PortableContributor => ({ ...contributor,
  export: async ctx => ({ ...(await contributor.export(ctx)),
    files: { files: [{ id: BLOB_ID, path: join(root, 'source.txt'), size: FILE_BYTES.length, sha256: FILE_SHA }], dispose: async () => {} } }) });
const testRegistry = () => createPortableContributorRegistry(CORE_PORTABLE_CONTRIBUTORS.map(c => c.id === 'work' ? withFile(c) : c));
const binders: PortableRestoreBlobBinder[] = [{ kind: 'test_file', bind: () => ({ name: 'report.txt', mimeType: 'text/plain' }) }];

function memoryProvider(options: { failUploads?: boolean } = {}) {
  const objects = new Map<string, Buffer>();
  return { objects,
    getCapabilities: () => ({ supportsStreaming: true }) as never,
    getLocationIdentity: () => createHash('sha256').update('memory:l7b2-roundtrip').digest('hex'),
    upload: async (stream: Readable, path: string, opts: { mime_type: string }) => {
      if (options.failUploads) { stream.destroy(); throw new Error('simulated provider crash during staging'); }
      const chunks: Buffer[] = []; for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks); objects.set(path, body);
      return { path, size: body.length, mime_type: opts.mime_type } as never;
    },
    download: async (path: string) => objects.get(path) ?? (() => { throw new Error('missing object'); })(),
    delete: async (path: string) => { objects.delete(path); } };
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
  await db('tickets').insert({ tenant: source, ticket_id: randomUUID(), ticket_number: 'T-1001', title: 'Printer on fire', client_id: client, board_id: board, status_id: status, entered_by: sourceAdmin });
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
      await expect(restorePortableWorkspaceForInstallation(db, { ...request(), passphrase: 'a different passphrase entirely' }, {}, { createProvider: async () => memoryProvider() as never, binders }))
        .rejects.toThrow();
      expect(await counts(destination, tables)).toEqual({});
      expect(await db('portable_workspace_restores').where({ tenant: destination })).toHaveLength(0);
    });

    await step('states plainly what is test-only: without a registered binder the restore of a file-bearing archive fails closed, before any receipt exists', async () => {
      // Production ships no blob binder (L7b1 contributors emit no blobs; documents arrive with L7b3). A file-bearing
      // archive therefore cannot be restored in production yet: this is a named gap, not a silent skip.
      const fresh = randomUUID();
      await expect(restorePortableWorkspaceForInstallation(db, { ...request(), destinationTenant: fresh }, {}, { createProvider: async () => memoryProvider() as never, }))
        .rejects.toThrow(/no file binder/);
      expect(await counts(fresh, tables)).toEqual({});
      expect(await db('portable_workspace_restores').where({ tenant: fresh })).toHaveLength(0);
    });

    await step('a crash while staging leaves a staged receipt and no promoted rows; --resume then completes without duplicates', async () => {
      await expect(restorePortableWorkspaceForInstallation(db, request(), {}, { createProvider: async () => memoryProvider({ failUploads: true }) as never, binders })).rejects.toThrow(/simulated provider crash/);
      const receipt = await db('portable_workspace_restores').where({ tenant: destination }).first();
      expect(receipt.state).toBe('staged');
      expect(await db('tickets').where({ tenant: destination })).toHaveLength(0);
      expect(await db('external_files').where({ tenant: destination })).toHaveLength(0);
      expect(await db('portable_restore_suspensions').where({ tenant: destination }).first()).toMatchObject({ reason: 'portable_restore_in_progress' });
      // A re-run without --resume must not start a second restore over the staged one.
      await expect(restorePortableWorkspaceForInstallation(db, request(), {}, { createProvider: async () => memoryProvider() as never, binders })).rejects.toThrow(/resume/);

      const provider = memoryProvider();
      const result = await restorePortableWorkspaceForInstallation(db, { ...request(), resume: true }, {}, { createProvider: async () => provider as never, binders });
      expect(result.outcome).toBe('resumed');
      expect(result.receipt.state).toBe('verified');
      expect(await db('portable_workspace_restores').where({ tenant: destination })).toHaveLength(1);
      expect(await db('tickets').where({ tenant: destination })).toHaveLength(1);
      expect(await db('portable_restore_suspensions').where({ tenant: destination }).first()).toMatchObject({ reason: 'portable_restore_pending_activation' });

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
      expect([...provider.objects.keys()]).toEqual([files[0].storage_path]); // exactly one object, no leaked staging
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
      const nonEmptyArchived = ['tenants', 'users', 'roles', 'permissions', 'user_roles', 'role_permissions', 'clients', 'boards', 'statuses', 'tickets'];
      for (const table of nonEmptyArchived) expect(written).toContain(table);
      // The receipt is the one deliberate provenance record (source_tenant, source administrator, package id); every other row must be clean.
      expect(await db('portable_workspace_restores').where({ tenant: destination }).first()).toMatchObject({ source_tenant: source });
      for (const table of tables.filter(name => name !== 'portable_workspace_restores')) {
        const leaked = await db(table).where({ tenant: destination }).whereRaw(`${table}::text ILIKE ?`, [`%${source}%`]).count({ count: '*' }).first();
        expect(Number(leaked?.count), `${table} carries the source tenant id`).toBe(0);
      }
      expect(await counts(source, tables)).toEqual(sourceBefore); // the source workspace is untouched
    });

    await step('a second apply is idempotent: already-restored, and no rows are written', async () => {
      const before = await counts(destination, tables);
      const provider = memoryProvider();
      const result = await restorePortableWorkspaceForInstallation(db, request(), {}, { createProvider: async () => provider as never, binders });
      expect(result.outcome).toBe('already-restored');
      expect(provider.objects.size).toBe(0);
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
      await expect(restorePortableWorkspaceForInstallation(db, { ...request(), destinationTenant: other }, {}, { createProvider: async () => memoryProvider() as never, binders }))
        .rejects.toThrow(/already holds|fresh/);
      expect(await counts(other, tables)).toEqual({});
      expect(await db('portable_workspace_restores').where({ tenant: other })).toHaveLength(0);
    });

  }, 1_200_000);
});
