import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { withCoManagedExportAdmin } from './portableExport';
import { hasCoManagedLocalPermission } from './localPermission';
import { portableSnapshotTransaction } from './portableSnapshot';
import { stageCoManagedPortableBlobs, type PortableSourceBlob } from './portableBlobStaging';
import { coManagedPortableNativeFilePath } from './portableNativeFilePath';
import type { PortableContributor, PortableContribution } from './portableContributorRegistry';
import { validatePortableRecordSection, type PortableRecords } from './portableRecordValidation';
import { CoManagedSharedWorkError, isCoManagedUuid, snapshotCoManagedSessionActor, type CoManagedSessionActor } from './sharedWorkIdentity';

/**
 * Tenant files, independent of the documents domain: the `external_files` file-store table and the storage-provider
 * read path. The projection omits `storage_path`, `file_name` and `metadata` (provider locators and free-form
 * provider state); the bytes travel as manifest blobs `file:<file_id>`. A document that points at a file owns that
 * edge (documents.file_id -> external_files.file_id) and resolves it when L7b3 registers; this contributor queries
 * no documents table and so a file only a document uses is still carried here, once, and deduplicated by blob id.
 */
export const CO_MANAGED_PORTABLE_FILE_COLUMNS = {
  external_files: ['file_id', 'original_name', 'mime_type', 'file_size', 'uploaded_by_id', 'created_at', 'updated_at'],
} as const;
export const CO_MANAGED_PORTABLE_FILE_REFERENCES = [['external_files', 'uploaded_by_id', 'users', 'user_id']] as const;
const COLUMNS = CO_MANAGED_PORTABLE_FILE_COLUMNS;
const LIMIT = 100_000;

export function validateCoManagedPortableFileRecords(input: unknown, workspace?: PortableRecords): asserts input is PortableRecords {
  validatePortableRecordSection(input, { columns: COLUMNS, references: CO_MANAGED_PORTABLE_FILE_REFERENCES,
    valueTypes: { external_files: { file_size: 'integer' } } });
  for (const row of (input as PortableRecords).external_files) {
    if (!Number.isSafeInteger(row.file_size) || (row.file_size as number) < 0 || typeof row.original_name !== 'string' || typeof row.mime_type !== 'string') throw new Error('Invalid portable file');
  }
  // An uploader outside the workspace's own users is a record that did not come from this tenant.
  if (workspace) {
    const users = new Set((workspace.users ?? []).map(user => String(user.user_id).toLowerCase()));
    if (!workspace.users || (input as PortableRecords).external_files.some(row => !users.has(String(row.uploaded_by_id).toLowerCase()))) throw new Error('Portable file uploader is not in the workspace');
  }
}

/** Reads the live, non-deleted files of the actor's tenant under row-share locks. Provider-free. */
async function collect(trx: Knex.Transaction, inputActor: CoManagedSessionActor) {
  if (!trx.isTransaction) throw new Error('Portable retention requires a transaction');
  const actor = snapshotCoManagedSessionActor(inputActor);
  return withCoManagedExportAdmin(trx, actor, async (current, verified) => {
    // The export-admin boundary already requires co_management.manage; files are authorised by that same grant.
    if (!await hasCoManagedLocalPermission(current, verified, 'co_management', 'manage', true)) throw new CoManagedSharedWorkError();
    const own = tenantDb(current, verified.tenant);
    const rows = await own.table('external_files').where(query => query.where('is_deleted', false).orWhereNull('is_deleted'))
      .select('file_id', 'storage_path', ...COLUMNS.external_files.filter(column => column !== 'file_id'))
      .orderBy('file_id').limit(LIMIT + 1).forShare();
    if (rows.length > LIMIT) throw new Error('Portable file limit exceeded');
    const sources: PortableSourceBlob[] = [];
    const records = { external_files: rows.map(row => {
      const size = Number(row.file_size);
      if (!isCoManagedUuid(row.file_id) || row.file_size === null || !Number.isSafeInteger(size) || size < 0) throw new Error('Portable file is unavailable');
      // Fail closed on a locator outside this tenant's native layouts: never read another owner's bytes.
      sources.push({ id: `file:${row.file_id}`, path: coManagedPortableNativeFilePath(verified.tenant, row.storage_path), size });
      return Object.fromEntries(COLUMNS.external_files.map(column => [column, column === 'file_size' ? size : row[column]]));
    }) };
    const projected = JSON.parse(JSON.stringify(records)) as PortableRecords;
    validateCoManagedPortableFileRecords(projected);
    return { records: projected, sources };
  });
}

// LEVERAGE: pattern portable-contributor-boilerplate — each contributor repeats the same admission wrapper, permission check, tenantDb handle and JSON round-trip; a defineTenantContributor() layer below would remove it.
/** Registry entry for tenant files. Stages bytes through the shared blob stager; the engine owns the lease. */
export const portableFileContributor: PortableContributor = {
  id: 'files', version: 1, reason: 'tenant file-store records and file contents',
  // document.read is not provisioned for co_managed tenants, so gating on it would exclude every customer's files.
  permissions: [{ resource: 'co_management', action: 'manage' }],
  columns: COLUMNS, references: CO_MANAGED_PORTABLE_FILE_REFERENCES,
  export: async (ctx): Promise<PortableContribution> => {
    if (ctx.db.isTransaction) throw new Error('Portable export requires a root database connection');
    const { records, sources } = await portableSnapshotTransaction(ctx.db, ctx.snapshot, trx => collect(trx, ctx.actor));
    return { records, files: await stageCoManagedPortableBlobs(sources) };
  },
  retain: async ctx => ({ records: (await collect(ctx.trx, ctx.actor)).records }),
  validate: (records, workspace) => validateCoManagedPortableFileRecords(records, workspace),
};
