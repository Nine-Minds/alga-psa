import type { Knex } from 'knex';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createPortableTemporaryDirectory } from '../../../../../packages/co-managed/src/portableTemporaryDirectory';
import { isAbsolute, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { StorageProviderFactory } from '@alga-psa/storage/StorageProviderFactory';
import { tenantDb } from '@alga-psa/db';
import { openPortableArchive, PORTABLE_ARCHIVE_LIMITS } from '../../../../../packages/co-managed/src/portableArchive';
import { validateCoManagedPortableWorkspaceManifest, type CoManagedPortableWorkspaceManifest } from '../../../../../packages/co-managed/src/portableWorkspaceManifest';
import { createCorePortableRegistry } from '../../../../../packages/co-managed/src/portableCoreRegistry';
import { prepareCoManagedPortableWorkspaceRecords } from '../../../../../packages/co-managed/src/portableWorkspaceRestoreRecords';
import { prepareCoManagedPortableWorkspaceFiles, stageCoManagedPortableWorkspaceFiles, type PortableRestoreBlobBinder } from '../../../../../packages/co-managed/src/portableWorkspaceRestoreFiles';
import { assertPortableTransferActive, awaitPortableTransfer, createPortableWriteStream, portableTransferSignal,
  withPortableTransfer, type PortableTransferOptions } from '../../../../../packages/co-managed/src/portableTransfer';
import { isCoManagedUuid } from '../../../../../packages/co-managed/src/sharedWorkIdentity';
import { prepareCoManagedPortableWorkspaceVault } from './portableWorkspaceRestoreVault';
import { insertCoManagedPortableWorkspaceDatabase, portableRestoreColumnNullability, resolveCoManagedPortableDestinationCatalogs } from './portableWorkspaceRestoreDatabase';
import { beginPortableRestoreUpload, commitPortableRestoreUpload, settlePortableRestoreUpload } from './portableWorkspaceRestoreUploads';
import { assertPortableRestoreInstallationAuthority } from './portableRestoreInstallationAuthority';
export { assertPortableRestoreInstallationAuthority } from './portableRestoreInstallationAuthority';

// A declaration, not a `const` arrow: only the former is treated as
// never-returning by control-flow analysis, so guards above actually narrow.
function fail(reason: string): never { throw new Error(`Portable installation restore rejected: ${reason}`); }
const same = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
type Provider = Parameters<typeof stageCoManagedPortableWorkspaceFiles>[1] & { getLocationIdentity?(): string };

/** `staged -> promoted -> verified`, advanced only by this coordinator under the restore lock. */
export type PortableRestoreState = 'staged' | 'promoted' | 'verified';
export interface PortableRestoreReceipt {
  tenant: string; source_tenant: string; package_id: string; archive_sha256: string; state: PortableRestoreState;
  source_administrator_user_id: string | null; administrator_user_id: string | null;
  created_at: Date | string; promoted_at: Date | string | null; verified_at: Date | string | null;
}
export interface PortableRestoreResult {
  receipt: PortableRestoreReceipt;
  /** `restored`: this call promoted and verified. `resumed`: continued an earlier attempt. `already-restored`: nothing to do. */
  outcome: 'restored' | 'resumed' | 'already-restored';
  /** Rows written per destination table, and how every other archive table was handled. */
  written: Record<string, number>; historical: string[]; globals: string[];
}
export interface PortableRestoreDependencies {
  createProvider?: () => Promise<Provider>;
  binders?: readonly PortableRestoreBlobBinder[];
}

/** An installation that already hosts co-managed state is not a fresh restore target. */
export async function assertFreshPortableRestoreInstallation(trx: Knex | Knex.Transaction, destinationTenant: string) {
  const { rows } = await trx.raw(`SELECT
      EXISTS (SELECT 1 FROM co_management_relationships) AS relationships,
      EXISTS (SELECT 1 FROM co_managed_entitlements) AS entitlements,
      EXISTS (SELECT 1 FROM portable_workspace_restores WHERE tenant <> ?) AS receipts`, [destinationTenant]);
  if (rows[0]?.relationships || rows[0]?.entitlements || rows[0]?.receipts) fail('installation already holds a co-managed relationship, entitlement or restore receipt');
}

function administrators(manifest: CoManagedPortableWorkspaceManifest) {
  const core = (manifest.sections.find(section => section.id === 'core') ?? fail('archive has no core section')).records;
  const permissions = new Set(core.permissions.filter(row => row.resource === 'co_management' && row.action === 'manage').map(row => row.permission_id));
  const roles = new Set(core.role_permissions.filter(row => permissions.has(row.permission_id)).map(row => row.role_id));
  const users = new Set(core.user_roles.filter(row => roles.has(row.role_id)).map(row => row.user_id));
  return core.users.filter(row => row.user_type === 'internal' && row.is_inactive === false && users.has(row.user_id))
    .map(row => ({ userId: String(row.user_id), name: [row.first_name, row.last_name].filter(Boolean).join(' '), email: String(row.email ?? '') }));
}

/** Copy the encrypted input once to private storage. Hashing and authentication
 * then refer to the same captured bytes even if the operator's source changes. */
async function withArchive<T>(archivePath: string, passphrase: string,
  work: (archive: Awaited<ReturnType<typeof openPortableArchive>>, manifest: CoManagedPortableWorkspaceManifest, sha256: string) => Promise<T>) {
  if (!isAbsolute(archivePath) || archivePath.includes('\0')) fail('absolute archive path required');
  const { directory: root, dispose } = await createPortableTemporaryDirectory('restore');
  let archive: Awaited<ReturnType<typeof openPortableArchive>> | undefined;
  try {
    const path = join(root, 'input.alga'), handle = await open(archivePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const hash = createHash('sha256'); let size = 0;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size < 1 || stat.size > PORTABLE_ARCHIVE_LIMITS.archiveBytes) fail('archive size or type');
      await pipeline(handle.createReadStream({ autoClose: false }), new Transform({ transform(chunk, _encoding, callback) {
        size += chunk.length; if (size > stat.size) return callback(new Error('Portable archive changed during capture'));
        hash.update(chunk); callback(null, chunk);
      } }), createPortableWriteStream(path), { signal: portableTransferSignal() });
      if (size !== stat.size) fail('archive changed during capture');
    } finally { await handle.close(); }
    archive = await openPortableArchive(path, passphrase);
    const manifest = validateCoManagedPortableWorkspaceManifest(archive.manifest, archive.context, archive.files, createCorePortableRegistry());
    return await work(archive, manifest, hash.digest('hex'));
  } finally {
    passphrase = '';
    try { await archive?.dispose(); } finally { await dispose(); }
  }
}

export async function inspectPortableWorkspaceArchive(archivePath: string, passphrase: string, options: PortableTransferOptions = {}) {
  try { return await withPortableTransfer(options, () => withArchive(archivePath, passphrase, async (_archive, manifest, sha256) => ({
    sourceTenant: manifest.context.sourceTenant, packageId: manifest.context.packageId, sha256,
    administrators: administrators(manifest),
  }))); } finally { passphrase = ''; }
}

/**
 * Destination identities must be a pure function of (archive, destination, allocation order): a crash
 * followed by --resume re-prepares the whole restore, and the receipt written before the crash already
 * names the administrator's destination id. Random allocation would make the resumed rows disagree with it.
 * Each stage draws from its own labelled stream, so the three prepare steps cannot collide with each other.
 */
function deterministicUuids(archiveSha256: string, tenant: string, stage: string): () => string {
  let counter = 0;
  return () => {
    const bytes = createHash('sha256').update(`portable-restore\0${archiveSha256}\0${tenant}\0${stage}\0${counter++}`).digest().subarray(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
}

const RECEIPT_SQL_COLUMNS = ['tenant', 'source_tenant', 'package_id', 'archive_sha256', 'state', 'source_administrator_user_id',
  'administrator_user_id', 'created_at', 'promoted_at', 'verified_at'] as const;

/**
 * Restore one archive into a fresh destination tenant.
 *
 *   --apply   begins a restore: refuses a non-fresh installation, then records a `staged` receipt (and a
 *             dedicated restore-suspension row), uploads and hash-verifies bytes, and promotes everything
 *             in one transaction (`promoted`), then verifies the written graph (`verified`).
 *   --resume  continues the same archive after an interruption, from whatever state the receipt records.
 *
 * A matching receipt makes a re-run idempotent (nothing is written twice); a different archive or
 * administrator can never reuse an existing destination. The passphrase is used only to open the archive
 * and re-wrap the vault, and is never written, logged or put in an error.
 */
export async function restorePortableWorkspaceForInstallation(db: Knex, input: {
  archivePath: string; passphrase: string; destinationTenant: string; sourceAdministratorUserId: string;
  resume?: boolean; maxStagedBytes?: number;
}, options: PortableTransferOptions = {}, dependencies: PortableRestoreDependencies = {}): Promise<PortableRestoreResult> {
  const request = { ...input };
  const createProvider = dependencies.createProvider ?? (() => StorageProviderFactory.createProvider() as Promise<Provider>);
  if (db.isTransaction || !isCoManagedUuid(request.destinationTenant) || !isCoManagedUuid(request.sourceAdministratorUserId)) fail('fresh destination and source administrator required');
  request.destinationTenant = request.destinationTenant.toLowerCase(); request.sourceAdministratorUserId = request.sourceAdministratorUserId.toLowerCase();
  try {
    return await withPortableTransfer(options, async () => {
      await assertPortableRestoreInstallationAuthority(db);
      return withArchive(request.archivePath, request.passphrase, async (archive, manifest, sha256) => {
        const sourceTenant = manifest.context.sourceTenant, tenant = request.destinationTenant;
        if (same(sourceTenant, tenant) || !administrators(manifest).some(user => same(user.userId, request.sourceAdministratorUserId))) fail('source workspace administrator required');
        const matches = (receipt: PortableRestoreReceipt) => same(receipt.source_tenant, sourceTenant) && same(receipt.package_id, manifest.context.packageId) &&
          receipt.archive_sha256 === sha256 && same(receipt.source_administrator_user_id, request.sourceAdministratorUserId);
        const lock = async (trx: Knex.Transaction) => {
          await assertPortableRestoreInstallationAuthority(trx);
          await trx.raw('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [`portable-restore:${tenant}`]);
        };
        const readReceipt = (trx: Knex.Transaction) => tenantDb(trx, tenant).table('portable_workspace_restores').first(...RECEIPT_SQL_COLUMNS) as Promise<PortableRestoreReceipt | undefined>;

        // 1. Read-only: what does this destination already hold?
        const prior = await db.transaction(async trx => { await lock(trx); return readReceipt(trx); });
        if (prior && !matches(prior)) fail('destination already belongs to another restore or workspace');
        if (prior?.state === 'verified') return { receipt: prior, outcome: 'already-restored' as const, written: {}, historical: [], globals: [] };
        if (prior && !request.resume) fail(`a restore of this archive is already ${prior.state}; re-run with --resume`);
        if (!prior && request.resume) fail('nothing to resume for this destination');

        // 2. Read-only preparation: nothing is written until every archive-level check has passed.
        const catalogs = await db.transaction(trx => resolveCoManagedPortableDestinationCatalogs(trx, manifest));
        const nullable = await db.transaction(trx => portableRestoreColumnNullability(trx, manifest));
        const records = prepareCoManagedPortableWorkspaceRecords({ manifest, destinationTenant: tenant, destinationCatalogMappings: catalogs, externalColumnNullable: nullable },
          { allocateUuid: deterministicUuids(sha256, tenant, 'records') });
        const administratorUserId = records.domains.find(domain => domain.table === 'users' && domain.column === 'user_id')!.mappings
          .find(pair => same(pair.source, request.sourceAdministratorUserId))?.destination;
        if (!isCoManagedUuid(administratorUserId)) fail('administrator identity mapping');
        const files = prepareCoManagedPortableWorkspaceFiles({ manifest, files: archive.files, preparedRecords: records, importedByUserId: administratorUserId,
          binders: dependencies.binders, maxStagedBytes: request.maxStagedBytes },
          { allocateUuid: deterministicUuids(sha256, tenant, 'files') });
        const vault = await prepareCoManagedPortableWorkspaceVault({ manifest, restoreRecords: files, passphrase: request.passphrase }, { reservedUuids: files.allocatedIds, allocateUuid: deterministicUuids(sha256, tenant, 'vault') });
        const summary = (written: Record<string, number>, historical: string[], globals: string[]) => ({ written, historical, globals });

        // 3. Begin: freshness, receipt (staged) and the dedicated suspension row, atomically.
        let receipt = prior;
        if (!prior) {
          receipt = await db.transaction(async trx => {
            await lock(trx);
            const raced = await readReceipt(trx);
            if (raced) fail('destination already belongs to another restore or workspace');
            await assertFreshPortableRestoreInstallation(trx, tenant);
            if (await tenantDb(trx, tenant).table('tenants').first('tenant')) fail('destination already belongs to another restore or workspace');
            const own = tenantDb(trx, tenant);
            await own.table('portable_workspace_restores').insert({ tenant, source_tenant: sourceTenant, package_id: manifest.context.packageId, archive_sha256: sha256,
              state: 'staged', source_administrator_user_id: request.sourceAdministratorUserId, administrator_user_id: administratorUserId });
            await own.table('portable_restore_suspensions').insert({ tenant, reason: 'portable_restore_in_progress' });
            return (await readReceipt(trx))!;
          });
        }
        let written: Record<string, number> = {}, historical: string[] = [], globals: string[] = [];

        // 4. Stage bytes, then promote everything in one transaction.
        if (receipt!.state === 'staged') {
          const provider = await awaitPortableTransfer(createProvider);
          assertPortableTransferActive();
          const attempt = await beginPortableRestoreUpload(db, { tenant, packageId: manifest.context.packageId, archiveSha256: sha256,
            fileIds: files.transfers.map(file => file.fileId) }, provider);
          let lease: Awaited<ReturnType<typeof stageCoManagedPortableWorkspaceFiles>> | undefined;
          try {
            lease = await stageCoManagedPortableWorkspaceFiles(files, provider, { attemptId: attempt.attemptId });
            const promoted = await db.transaction(async trx => {
              assertPortableTransferActive();
              await lock(trx);
              const current = await readReceipt(trx);
              if (!current || !matches(current)) fail('restore receipt changed');
              if (current.state !== 'staged') return undefined; // a concurrent resume already promoted
              const result = await insertCoManagedPortableWorkspaceDatabase(trx, { preparedRecords: files, externalFiles: lease!.externalFiles, vault });
              const own = tenantDb(trx, tenant);
              await own.table('portable_workspace_restores').where({ state: 'staged' }).update({ state: 'promoted', promoted_at: trx.fn.now() });
              await own.table('portable_restore_suspensions').update({ reason: 'portable_restore_pending_activation' });
              await commitPortableRestoreUpload(trx, attempt, lease!.externalFiles);
              assertPortableTransferActive();
              return result;
            });
            if (promoted) { lease.release(); written = promoted.written; historical = promoted.historical; globals = promoted.globals; }
          } finally {
            // The journal resolves committed vs abandoned state under the same
            // destination lock. Database uncertainty always preserves objects;
            // the durable attempt remains available for later maintenance.
            let retain = true;
            try { retain = await settlePortableRestoreUpload(db, attempt); } catch {}
            if (retain) lease?.release();
            await lease?.dispose();
          }
        }

        // 5. Verify what is actually in the destination against what the archive said it carried.
        const verified = await db.transaction(async trx => {
          await lock(trx);
          const current = await readReceipt(trx);
          if (!current || !matches(current)) fail('restore receipt changed');
          if (current.state === 'staged') fail('restore was not promoted');
          const expected = await expectedCounts(files);
          for (const [table, count] of Object.entries(expected)) {
            const row = await trx(table).where({ tenant }).count({ count: '*' }).first();
            if (Number(row?.count) !== count) fail(`verification failed for ${table}`);
          }
          if (current.state === 'promoted') await tenantDb(trx, tenant).table('portable_workspace_restores').where({ state: 'promoted' }).update({ state: 'verified', verified_at: trx.fn.now() });
          return { receipt: (await readReceipt(trx))!, expected };
        });
        if (!Object.keys(written).length) ({ written, historical, globals } = summary(verified.expected, [...new Set(files.profiles.flatMap(profile => [...(profile.historical ?? [])]))].sort(), Object.keys(files.globalCatalogs).sort()));
        return { receipt: verified.receipt, outcome: prior ? 'resumed' as const : 'restored' as const, written, historical, globals };
      });
    });
  } finally { request.passphrase = ''; }
}

/** Expected per-table destination row counts, derived from the same prepared graph that was inserted. */
async function expectedCounts(files: ReturnType<typeof prepareCoManagedPortableWorkspaceFiles>) {
  const historical = new Set(files.profiles.flatMap(profile => [...(profile.historical ?? [])]));
  const globals = new Set(Object.keys(files.globalCatalogs));
  const counts: Record<string, number> = {};
  for (const table of files.tables) if (!historical.has(table) && !globals.has(table)) counts[table] = files.records[table].length;
  counts.external_files = files.externalFiles.length;
  return counts;
}
