import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { withCoManagedExportAdmin } from './portableExport';
import { portableSnapshotTransaction, type CoManagedPortableSnapshot } from './portableSnapshot';
import { consumeCoManagedMeetingArtifact } from './nativeMeetingRead';
import { stageCoManagedPortableBlobs } from './portableBlobStaging';
import { coManagedPortableNativeFilePath } from './portableNativeFilePath';
import { CoManagedSharedWorkError, isCoManagedUuid, snapshotCoManagedSessionActor, type CoManagedSessionActor } from './sharedWorkIdentity';

const checksum = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function collect(db: Knex, actor: CoManagedSessionActor, databaseSnapshot?: CoManagedPortableSnapshot) {
  return portableSnapshotTransaction(db, databaseSnapshot, trx => withCoManagedExportAdmin(trx, actor, async (current, verified) => {
    const own = tenantDb(current, verified.tenant);
    const hints = await own.table('online_meeting_artifacts').whereNotNull('file_id').orderBy('artifact_id').limit(100_001)
      .select('artifact_id', 'meeting_id', 'document_id', 'file_id', 'artifact_type', 'created_at', 'updated_at');
    if (hints.length > 100_000) throw new Error('Portable supplemental file limit exceeded');
    const metadata = new Map<string, any>();
    for (const hint of hints) {
      if (!isCoManagedUuid(hint.file_id)) throw new CoManagedSharedWorkError();
      // Native artifact consumption retains every actual appointment,
      // interaction/private calendar, canonical artifact, document and file.
      // The callback returns no provider locator or customer content.
      const admitted = await consumeCoManagedMeetingArtifact(current, verified.tenant, hint.artifact_id, async () => verified,
        async content => ({ value: { fileId: content.fileId } }));
      if (!admitted.handled || admitted.value.fileId !== hint.file_id) throw new CoManagedSharedWorkError();
      const retained = await own.table('online_meeting_artifacts').where('artifact_id', hint.artifact_id).forShare()
        .first('artifact_id', 'meeting_id', 'document_id', 'file_id', 'artifact_type', 'created_at', 'updated_at');
      if (!retained || JSON.stringify(retained) !== JSON.stringify(hint)) throw new CoManagedSharedWorkError();
      if (!metadata.has(hint.file_id)) {
        const file = await own.table('external_files').where('file_id', hint.file_id).forShare()
          .first('file_id', 'storage_path', 'file_size', 'original_name', 'mime_type', 'is_deleted', 'created_at', 'updated_at');
        const size = Number(file?.file_size);
        if (!file || file.is_deleted || file.file_size === null || !Number.isSafeInteger(size) || size < 0) throw new Error('Portable supplemental file is unavailable');
        coManagedPortableNativeFilePath(verified.tenant, file.storage_path);
        metadata.set(hint.file_id, file);
      }
    }
    // The document component already captures these native blobs. Partition by
    // actual file references, not artifact.document_id: an artifact's file may
    // differ from its document's primary/preview files. This same partition is
    // recomputed in the fresh post-provider admission before returning a lease.
    const ids = [...metadata.keys()].sort(), coveredDocuments: any[] = [];
    for (let offset = 0; offset < ids.length; offset += 1000) {
      const part = ids.slice(offset, offset + 1000);
      const coverage = await own.table('documents').where(query => query.whereIn('file_id', part)
        .orWhereIn('thumbnail_file_id', part).orWhereIn('preview_file_id', part)).orderBy('document_id').limit(100_001)
        .select('document_id', 'file_id', 'thumbnail_file_id', 'preview_file_id');
      if (coverage.length > 100_000) throw new Error('Portable document file coverage limit exceeded');
      coveredDocuments.push(...coverage);
    }
    const coverage = [...new Map(coveredDocuments.map(row => [row.document_id, row])).values()].sort((a, b) => a.document_id.localeCompare(b.document_id));
    if (coverage.length > 100_000) throw new Error('Portable document file coverage limit exceeded');
    const covered = new Set(coverage.flatMap(row => [row.file_id, row.thumbnail_file_id, row.preview_file_id]).filter(Boolean));
    const files = ids.map(id => metadata.get(id));
    return { artifacts: hints, files, coverage,
      bindings: hints.map(row => ({ table: 'online_meeting_artifacts', recordId: row.artifact_id, field: 'file_id', blobId: `file:${row.file_id}` })),
      blobs: files.filter(file => !covered.has(file.file_id)).map(file => ({ id: `file:${file.file_id}`,
        path: coManagedPortableNativeFilePath(verified.tenant, file.storage_path), size: Number(file.file_size), name: file.original_name, mimeType: file.mime_type })) };
  }));
}

/** Actual native artifact bytes missing from the document component. The
 * assembler consumes the lease and disposes it in finally. Provider-only
 * recordings are not represented by these native-file references. */
export async function exportCoManagedPortableSupplementalFiles(db: Knex, inputActor: CoManagedSessionActor, packageId: string, databaseSnapshot?: CoManagedPortableSnapshot) {
  if (db.isTransaction) throw new Error('Portable export requires a root database connection');
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!isCoManagedUuid(packageId)) throw new CoManagedSharedWorkError();
  const snapshot = await collect(db, actor, databaseSnapshot), original = checksum(snapshot);
  const staged = await stageCoManagedPortableBlobs(snapshot.blobs);
  try {
    if (checksum(await collect(db, actor)) !== original) throw new CoManagedSharedWorkError();
    const payload = JSON.parse(JSON.stringify({ kind: 'alga-workspace-supplemental-files', version: 1, packageId, sourceTenant: actor.tenant,
      fileBindings: snapshot.bindings, restorePolicy: { sponsorship: 'none', providerConnections: 'none' },
      blobs: snapshot.blobs.map(({ path: _path, ...blob }) => ({ ...blob, sha256: staged.files.find(file => file.id === blob.id)!.sha256 })) }));
    return { component: { ...payload, sha256: checksum(payload) }, files: staged.files, dispose: staged.dispose };
  } catch (error) { await staged.dispose(); throw error; }
}
