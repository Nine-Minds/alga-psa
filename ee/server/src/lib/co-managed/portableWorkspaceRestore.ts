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
import { prepareCoManagedPortableWorkspaceRecords } from '../../../../../packages/co-managed/src/portableWorkspaceRestoreRecords';
import { prepareCoManagedPortableWorkspaceFiles, stageCoManagedPortableWorkspaceFiles } from '../../../../../packages/co-managed/src/portableWorkspaceRestoreFiles';
import { assertPortableTransferActive, awaitPortableTransfer, createPortableWriteStream, portableTransferSignal,
  withPortableTransfer, type PortableTransferOptions } from '../../../../../packages/co-managed/src/portableTransfer';
import { isCoManagedUuid } from '../../../../../packages/co-managed/src/sharedWorkIdentity';
import { prepareCoManagedPortableWorkspaceVault } from './portableWorkspaceRestoreVault';
import { insertCoManagedPortableWorkspaceDatabase, resolveCoManagedPortableDestinationCatalogs } from './portableWorkspaceRestoreDatabase';

const fail = (reason: string): never => { throw new Error(`Portable installation restore rejected: ${reason}`); };
const same = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
type Provider = Parameters<typeof stageCoManagedPortableWorkspaceFiles>[1] & { getLocationIdentity?(): string };
import { beginPortableRestoreUpload, commitPortableRestoreUpload, settlePortableRestoreUpload } from './portableWorkspaceRestoreUploads';
export interface PortableRestoreReceipt {
  tenant: string; source_tenant: string; package_id: string; archive_sha256: string;
  source_administrator_user_id: string; administrator_user_id: string; restored_at: Date | string;
}

import { assertPortableRestoreInstallationAuthority } from './portableRestoreInstallationAuthority';
export { assertPortableRestoreInstallationAuthority } from './portableRestoreInstallationAuthority';

function administrators(manifest: CoManagedPortableWorkspaceManifest) {
  const core = manifest.sections.core.records;
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
    const manifest = validateCoManagedPortableWorkspaceManifest(archive.manifest, archive.context, archive.files);
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

/** Explicit destination identity makes retries converge without reusing source
 * UUIDs. Only a committed matching receipt is reusable; a different archive or
 * administrator can never replace an existing tenant. Provider objects are
 * staged before the atomic native insertion and released only after commit. */
export async function restorePortableWorkspaceForInstallation(db: Knex, input: {
  archivePath: string; passphrase: string; destinationTenant: string; sourceAdministratorUserId: string;
}, options: PortableTransferOptions = {}, createProvider: () => Promise<Provider> = () => StorageProviderFactory.createProvider()): Promise<PortableRestoreReceipt> {
  const request = { ...input };
  if (db.isTransaction || !isCoManagedUuid(request.destinationTenant) || !isCoManagedUuid(request.sourceAdministratorUserId)) fail('fresh destination and source administrator required');
  request.destinationTenant = request.destinationTenant.toLowerCase(); request.sourceAdministratorUserId = request.sourceAdministratorUserId.toLowerCase();
  try {
    return await withPortableTransfer(options, async () => {
      await assertPortableRestoreInstallationAuthority(db);
      return withArchive(request.archivePath, request.passphrase, async (archive, manifest, sha256) => {
        const sourceTenant = manifest.context.sourceTenant, tenant = request.destinationTenant;
        if (same(sourceTenant, tenant) || !administrators(manifest).some(user => same(user.userId, request.sourceAdministratorUserId))) fail('source workspace administrator required');
        const existing = async (trx: Knex.Transaction): Promise<PortableRestoreReceipt | undefined> => {
          await assertPortableRestoreInstallationAuthority(trx);
          await trx.raw('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [`portable-restore:${tenant}`]);
          const own = tenantDb(trx, tenant), receipt = await own.table('portable_workspace_restores').first() as PortableRestoreReceipt | undefined;
          if (receipt && same(receipt.source_tenant, sourceTenant) && same(receipt.package_id, manifest.context.packageId) &&
              receipt.archive_sha256 === sha256 && same(receipt.source_administrator_user_id, request.sourceAdministratorUserId)) return receipt;
          if (receipt || await own.table('tenants').first('tenant')) fail('destination already belongs to another restore or workspace');
        };
        const prior = await db.transaction(existing); if (prior) return prior;
        const sections = Object.fromEntries(Object.entries(manifest.sections).map(([name, component]) => [name, component.records]));
        const catalogs = await db.transaction(trx => resolveCoManagedPortableDestinationCatalogs(trx, sections as any, sourceTenant));
        const records = prepareCoManagedPortableWorkspaceRecords({ sourceTenant, destinationTenant: tenant, sections: sections as any, destinationCatalogMappings: catalogs });
        const administratorUserId = records.domains.find(domain => domain.table === 'users' && domain.column === 'user_id')!.mappings
          .find(pair => same(pair.source, request.sourceAdministratorUserId))?.destination;
        if (!isCoManagedUuid(administratorUserId)) fail('administrator identity mapping');
        const files = prepareCoManagedPortableWorkspaceFiles({ manifest, files: archive.files, preparedRecords: records, importedByUserId: administratorUserId });
        const vault = await prepareCoManagedPortableWorkspaceVault({ manifest, restoreRecords: files, passphrase: request.passphrase }, { reservedUuids: files.allocatedIds });
        const provider = await awaitPortableTransfer(createProvider);
        assertPortableTransferActive();
        const attempt = await beginPortableRestoreUpload(db, { tenant, packageId: manifest.context.packageId, archiveSha256: sha256,
          fileIds: files.transfers.map(file => file.fileId) }, provider);
        let lease: Awaited<ReturnType<typeof stageCoManagedPortableWorkspaceFiles>> | undefined;
        try {
          lease = await stageCoManagedPortableWorkspaceFiles(files, provider, { attemptId: attempt.attemptId });
          const result = await db.transaction(async trx => {
            assertPortableTransferActive();
            const prior = await existing(trx); if (prior) return { receipt: prior, inserted: false };
            await insertCoManagedPortableWorkspaceDatabase(trx, { preparedRecords: files, externalFiles: lease!.externalFiles, vault,
              archive: { packageId: manifest.context.packageId, sha256, sourceAdministratorUserId: request.sourceAdministratorUserId, administratorUserId } });
            await commitPortableRestoreUpload(trx, attempt, lease!.externalFiles);
            assertPortableTransferActive();
            return { receipt: await tenantDb(trx, tenant).table('portable_workspace_restores').first() as PortableRestoreReceipt, inserted: true };
          });
          if (result.inserted) lease.release();
          return result.receipt;
        } finally {
          // The journal resolves committed vs abandoned state under the same
          // destination lock. Database uncertainty always preserves objects;
          // the durable attempt remains available for later maintenance.
          let retain = true;
          try { retain = await settlePortableRestoreUpload(db, attempt); } catch {}
          if (retain) lease?.release();
          await lease?.dispose();
        }
      });
    });
  } finally { request.passphrase = ''; }
}
