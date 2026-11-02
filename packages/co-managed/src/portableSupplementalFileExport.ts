import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { portableSnapshotTransaction } from './portableSnapshot';
import { validatePortableRecordSection, type PortableRecords } from './portableRecordValidation';
import type { PortableContributor, PortableContribution } from './portableContributorRegistry';
import { withCoManagedExportAdmin } from './portableExport';
import { hasCoManagedLocalPermission } from './localPermission';
import { stageCoManagedPortableBlobs } from './portableBlobStaging';
import { readPortableFileSources, CO_MANAGED_PORTABLE_FILE_CAPS } from './portableDocumentExport';
import { CoManagedSharedWorkError, isCoManagedUuid, snapshotCoManagedSessionActor, type CoManagedSessionActor } from './sharedWorkIdentity';

/** Meeting artifacts whose bytes already live in tenant storage. Only native
 * files that no document covers are staged here (documents stage their own);
 * provider-only recordings and transcripts have no file_id, are never fetched
 * from the provider, and are recorded as an exclusion. Owning this table here
 * keeps the EE meeting contributor free of file transport. */
export const CO_MANAGED_PORTABLE_SUPPLEMENTAL_COLUMNS = {
  online_meeting_artifacts: ['artifact_id', 'meeting_id', 'artifact_type', 'document_id', 'file_id', 'created_date_time', 'created_at', 'updated_at'],
} as const;
export const CO_MANAGED_PORTABLE_SUPPLEMENTAL_REFERENCES = [
  ['online_meeting_artifacts', 'document_id', 'documents', 'document_id'],
] as const;
const LIMIT = 100_000;

export function validateCoManagedPortableSupplementalRecords(input: unknown): asserts input is PortableRecords {
  validatePortableRecordSection(input, { columns: CO_MANAGED_PORTABLE_SUPPLEMENTAL_COLUMNS, references: CO_MANAGED_PORTABLE_SUPPLEMENTAL_REFERENCES });
}

async function collect(trx: Knex.Transaction, inputActor: CoManagedSessionActor, packageId: string, notProvisioned: ReadonlySet<string> = new Set()) {
  if (!trx.isTransaction) throw new Error('Portable retention requires a transaction');
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!isCoManagedUuid(packageId)) throw new CoManagedSharedWorkError();
  return withCoManagedExportAdmin(trx, actor, async (current, verified) => {
    // document.read gates the sole table; unprovisioned (engine-declared) means empty with no file reads, provisioned-but-not-held still throws.
    if (notProvisioned.has('online_meeting_artifacts')) {
      return { records: { online_meeting_artifacts: [] } as PortableRecords, sources: { blobs: [], excluded: [], bytes: 0 }, providerOnly: 0 };
    }
    if (!await hasCoManagedLocalPermission(current, verified, 'document', 'read', true)) throw new CoManagedSharedWorkError();
    const own = tenantDb(current, verified.tenant), columns = CO_MANAGED_PORTABLE_SUPPLEMENTAL_COLUMNS.online_meeting_artifacts;
    const artifacts: Record<string, unknown>[] = await own.table('online_meeting_artifacts').select(...columns).orderBy('artifact_id').limit(LIMIT + 1).forShare();
    if (artifacts.length > LIMIT) throw new Error('Portable supplemental file limit exceeded');
    const covered = new Set<string>();
    for (const row of await own.table('documents').select('file_id', 'thumbnail_file_id', 'preview_file_id').limit(LIMIT + 1).forShare()) {
      for (const id of [row.file_id, row.thumbnail_file_id, row.preview_file_id]) if (typeof id === 'string') covered.add(id);
    }
    const wanted = artifacts.map(row => row.file_id).filter((id): id is string => typeof id === 'string' && !covered.has(id));
    const sources = await readPortableFileSources(own, wanted);
    const records = { online_meeting_artifacts: artifacts } as PortableRecords;
    validateCoManagedPortableSupplementalRecords(records);
    return { records, sources, providerOnly: artifacts.filter(row => row.file_id === null).length };
  });
}

const exclusionsOf = (excluded: readonly { id: string; reason: string }[], providerOnly: number) => [
  { class: 'secret', name: 'meeting_provider_artifacts', reason: `${providerOnly} provider-only recordings/transcripts have no tenant file and are never fetched from the provider.` },
  ...excluded.map(file => ({ class: 'deferred_domain', name: `file:${file.id}`, reason: `Artifact file bytes not exported: ${file.reason}.` })),
];

// LEVERAGE: pattern portable-contributor-boilerplate — repeats the admission wrapper, permission check, tenantDb handle and JSON round-trip of the core/work/assets contributors.
export const portableSupplementalFileContributor: PortableContributor = {
  id: 'artifacts', version: 1, reason: 'meeting artifact records and the tenant-stored files no document covers',
  permissions: [{ resource: 'document', action: 'read' }],
  columns: CO_MANAGED_PORTABLE_SUPPLEMENTAL_COLUMNS, references: CO_MANAGED_PORTABLE_SUPPLEMENTAL_REFERENCES,
  export: async (ctx): Promise<PortableContribution> => {
    if (ctx.db.isTransaction) throw new Error('Portable export requires a root database connection');
    const actor = snapshotCoManagedSessionActor(ctx.actor);
    if (!isCoManagedUuid(ctx.packageId)) throw new CoManagedSharedWorkError();
    // LEVERAGE: pattern portable-export-is-snapshot-retain — export is the retain run at the shared snapshot.
    const snapshot = await portableSnapshotTransaction(ctx.db, ctx.snapshot, trx => collect(trx, actor, ctx.packageId, ctx.notProvisioned));
    const staged = await stageCoManagedPortableBlobs(snapshot.sources.blobs);
    try {
      return { records: JSON.parse(JSON.stringify(snapshot.records)) as PortableRecords, files: staged,
        annotations: { exclusions: exclusionsOf(snapshot.sources.excluded, snapshot.providerOnly), caps: CO_MANAGED_PORTABLE_FILE_CAPS,
          fileBindings: snapshot.records.online_meeting_artifacts.filter(row => row.file_id).map(row => ({ table: 'online_meeting_artifacts', recordId: row.artifact_id, field: 'file_id', blobId: `file:${row.file_id}` })) } };
    } catch (error) { await staged.dispose(); throw error; }
  },
  retain: async ctx => {
    const { records, sources, providerOnly } = await collect(ctx.trx, ctx.actor, ctx.packageId, ctx.notProvisioned);
    return { records, annotations: { exclusions: exclusionsOf(sources.excluded, providerOnly) } };
  },
  validate: records => validateCoManagedPortableSupplementalRecords(records),
};
