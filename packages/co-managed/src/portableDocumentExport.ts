import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { portableSnapshotTransaction } from './portableSnapshot';
import { validatePortableRecordSection, type PortableRecords } from './portableRecordValidation';
import type { PortableContributor, PortableContribution } from './portableContributorRegistry';
import { withCoManagedExportAdmin } from './portableExport';
import { hasCoManagedLocalPermission } from './localPermission';
import { stageCoManagedPortableBlobs, type PortableSourceBlob } from './portableBlobStaging';
import { coManagedPortableNativeFilePath } from './portableNativeFilePath';
import { CoManagedSharedWorkError, isCoManagedUuid, snapshotCoManagedSessionActor, type CoManagedSessionActor } from './sharedWorkIdentity';
import { CO_MANAGED_PORTABLE_DOCUMENT_COLUMNS, CO_MANAGED_PORTABLE_DOCUMENT_REFERENCES,
  commercialPortableDocumentIds, filterCommercialPortableDocuments, type CoManagedPortableDocumentRecords, type CoManagedPortableDocumentTable } from './portableDocumentCatalog';

/** One file may not exceed this and the package may not exceed the total. A file
 * over either cap is never truncated: it is left out and named in the section's
 * exclusions, and its row keeps the file id so restore can see it is missing. */
export const CO_MANAGED_PORTABLE_FILE_CAPS = Object.freeze({ perFileBytes: 100 * 1024 * 1024, packageBytes: 1024 * 1024 * 1024 });
const LIMIT = 100_000, CHUNK = 1000;
type Rows = Record<string, unknown>[];
export interface PortableFileExclusion { id: string; reason: 'over_file_cap' | 'over_package_cap' | 'missing_or_deleted' | 'unsized' }

/** Storage metadata of the given native files, path-scoped to the handle's tenant and
 * capped. `taken` is bytes already claimed by earlier readers in this package. */
export async function readPortableFileSources(own: ReturnType<typeof tenantDb>, fileIds: readonly string[], taken = 0) {
  const blobs: (PortableSourceBlob & { name: unknown; mimeType: unknown })[] = [], excluded: PortableFileExclusion[] = [];
  const ids = [...new Set(fileIds)].sort(), metadata = new Map<string, Record<string, any>>();
  for (let offset = 0; offset < ids.length; offset += CHUNK) {
    for (const row of await own.table('external_files').whereIn('file_id', ids.slice(offset, offset + CHUNK)).forShare()
      .select('file_id', 'storage_path', 'file_size', 'original_name', 'mime_type', 'is_deleted')) metadata.set(String(row.file_id), row);
  }
  let total = taken;
  for (const id of ids) {
    if (!isCoManagedUuid(id)) throw new CoManagedSharedWorkError();
    const file = metadata.get(id), size = Number(file?.file_size);
    if (!file || file.is_deleted) { excluded.push({ id, reason: 'missing_or_deleted' }); continue; }
    if (file.file_size === null || !Number.isSafeInteger(size) || size < 0) { excluded.push({ id, reason: 'unsized' }); continue; }
    const path = coManagedPortableNativeFilePath(own.tenant, file.storage_path);
    if (size > CO_MANAGED_PORTABLE_FILE_CAPS.perFileBytes) { excluded.push({ id, reason: 'over_file_cap' }); continue; }
    if (total + size > CO_MANAGED_PORTABLE_FILE_CAPS.packageBytes) { excluded.push({ id, reason: 'over_package_cap' }); continue; }
    total += size;
    blobs.push({ id: `file:${id}`, path, size, name: file.original_name, mimeType: file.mime_type });
  }
  return { blobs, excluded, bytes: total - taken };
}

export function validateCoManagedPortableDocumentRecords(input: unknown): asserts input is CoManagedPortableDocumentRecords {
  validatePortableRecordSection(input, { columns: CO_MANAGED_PORTABLE_DOCUMENT_COLUMNS, references: CO_MANAGED_PORTABLE_DOCUMENT_REFERENCES });
  const records = input as CoManagedPortableDocumentRecords;
  // Commercial documents are filtered before this runs; their presence means the filter was bypassed.
  if (commercialPortableDocumentIds(records.documents, records.document_associations).size) throw new Error('Portable documents must not include commercial documents');
}

async function collect(trx: Knex.Transaction, inputActor: CoManagedSessionActor, packageId: string) {
  if (!trx.isTransaction) throw new Error('Portable retention requires a transaction');
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!isCoManagedUuid(packageId)) throw new CoManagedSharedWorkError();
  return withCoManagedExportAdmin(trx, actor, async (current, verified) => {
    if (!await hasCoManagedLocalPermission(current, verified, 'document', 'read', true)) throw new CoManagedSharedWorkError();
    const own = tenantDb(current, verified.tenant), raw = {} as CoManagedPortableDocumentRecords;
    for (const table of Object.keys(CO_MANAGED_PORTABLE_DOCUMENT_COLUMNS) as CoManagedPortableDocumentTable[]) {
      const columns = CO_MANAGED_PORTABLE_DOCUMENT_COLUMNS[table];
      raw[table] = await own.table(table).select(...columns).orderBy(columns[0]).limit(LIMIT + 1).forShare();
      if (raw[table].length > LIMIT) throw new Error('Portable document record limit exceeded');
    }
    // Commercial documents are dropped here, before validation, file lookup and staging.
    const { records, excludedDocuments } = filterCommercialPortableDocuments(raw);
    validateCoManagedPortableDocumentRecords(records);
    const fileIds = records.documents.flatMap(row => [row.file_id, row.thumbnail_file_id, row.preview_file_id]).filter((id): id is string => typeof id === 'string');
    const sources = await readPortableFileSources(own, fileIds);
    return { tenant: verified.tenant, records, sources, excludedDocuments };
  });
}

const exclusionsOf = (excluded: readonly PortableFileExclusion[], excludedDocuments = 0) => [
  { class: 'commercial', name: 'commercial_documents', reason: `Documents attached to invoices, quotes, contracts, sales orders, opportunities or any entity type outside the customer-operational allowlist, or rendered from a billing template, are not exported with their versions, content, associations, knowledge-base rows and file bytes (${excludedDocuments} excluded).` },
  { class: 'secret', name: 'document_storage_locations', reason: 'Storage paths and provider locators are transport-only and never recorded.' },
  { class: 'commercial', name: 'document_templates', reason: 'Document render templates and their assignments are billing presentation configuration and are not exported.' },
  { class: 'deferred_domain', name: 'shared_document_types', reason: 'Global shared document types are not tenant data; documents.shared_type_id is an external edge.' },
  ...excluded.map(file => ({ class: 'deferred_domain', name: `file:${file.id}`, reason: `File bytes not exported: ${file.reason}.` })),
];

// LEVERAGE: pattern portable-contributor-boilerplate — repeats the admission wrapper, permission check, tenantDb handle and JSON round-trip of the core/work/assets contributors.
export const portableDocumentContributor: PortableContributor = {
  id: 'documents', version: 1, reason: 'customer-owned documents, versions, folders, knowledge base and their file bytes',
  columns: CO_MANAGED_PORTABLE_DOCUMENT_COLUMNS, references: CO_MANAGED_PORTABLE_DOCUMENT_REFERENCES,
  export: async (ctx): Promise<PortableContribution> => {
    if (ctx.db.isTransaction) throw new Error('Portable export requires a root database connection');
    const actor = snapshotCoManagedSessionActor(ctx.actor);
    if (!isCoManagedUuid(ctx.packageId)) throw new CoManagedSharedWorkError();
    // LEVERAGE: pattern portable-export-is-snapshot-retain — export is the retain run at the shared snapshot.
    const snapshot = await portableSnapshotTransaction(ctx.db, ctx.snapshot, trx => collect(trx, actor, ctx.packageId));
    const staged = await stageCoManagedPortableBlobs(snapshot.sources.blobs);
    try {
      const bindings = snapshot.records.documents.flatMap(row => (['file_id', 'thumbnail_file_id', 'preview_file_id'] as const)
        .filter(field => typeof row[field] === 'string').map(field => ({ table: 'documents', recordId: row.document_id, field, blobId: `file:${row[field]}` })));
      return { records: JSON.parse(JSON.stringify(snapshot.records)) as PortableRecords, files: staged,
        annotations: { exclusions: exclusionsOf(snapshot.sources.excluded, snapshot.excludedDocuments), fileBindings: bindings, caps: CO_MANAGED_PORTABLE_FILE_CAPS,
          restorePolicy: { sponsorship: 'none', providerConnections: 'none' } } };
    } catch (error) { await staged.dispose(); throw error; }
  },
  retain: async ctx => {
    const { records, sources, excludedDocuments } = await collect(ctx.trx, ctx.actor, ctx.packageId);
    return { records: JSON.parse(JSON.stringify(records)) as PortableRecords, annotations: { exclusions: exclusionsOf(sources.excluded, excludedDocuments) } };
  },
  validate: records => validateCoManagedPortableDocumentRecords(records),
};
