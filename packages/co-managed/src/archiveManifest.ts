import { createHash } from 'node:crypto';
import { tenantDb } from '@alga-psa/db';
import type { CoManagedClosureEvidenceContext } from './relationshipClosure';
import { isCoManagedUuid, CoManagedSharedWorkError } from './sharedWorkIdentity';

export interface CoManagedArchiveManifest {
  version: 1;
  /** Immutable evidence identity and its original full-content checksum. */
  evidence: [id: string, hash: string][];
  /** Immutable file identity, byte checksum and size; storage state can advance. */
  files: [id: string, hash: string, size: number][];
}

/** Hash a fixed ordered representation, independent of JSONB object-key order. */
export function coManagedArchiveManifestHash(identity: { tenant: string; customer_tenant: string; relationship_id: string; operation_id: string; cutoff_at: Date | string }, manifest: CoManagedArchiveManifest): string {
  return createHash('sha256').update(JSON.stringify([manifest.version, identity.tenant, identity.customer_tenant,
    identity.relationship_id, identity.operation_id, new Date(identity.cutoff_at).toISOString(), manifest.evidence, manifest.files])).digest('hex');
}

/** Closure calls this after its source-specific finalizer while retaining the
 * exclusive relationship lock. Only already-owned archive rows enter the seal;
 * this never revisits customer content or waits for a remote storage worker. */
export async function sealCoManagedArchive(context: CoManagedClosureEvidenceContext): Promise<void> {
  const { trx, sponsorTenant, customerTenant, relationshipId, operationId, cutoffAt } = context;
  if (!trx.isTransaction || sponsorTenant === customerTenant || ![sponsorTenant, customerTenant, relationshipId, operationId].every(isCoManagedUuid) ||
      !(cutoffAt instanceof Date) || !Number.isFinite(cutoffAt.getTime())) throw new CoManagedSharedWorkError();
  const owner = tenantDb(trx, sponsorTenant), key = { customer_tenant: customerTenant, relationship_id: relationshipId };
  const identity = { tenant: sponsorTenant, ...key, operation_id: operationId, cutoff_at: cutoffAt };
  const previous = await owner.table('co_managed_archive_manifests').where('operation_id', operationId).forShare().first();
  if (previous) {
    if (previous.customer_tenant !== customerTenant || previous.relationship_id !== relationshipId ||
        new Date(previous.cutoff_at).getTime() !== cutoffAt.getTime() || coManagedArchiveManifestHash(identity, previous.manifest) !== previous.content_hash) {
      throw new Error('Archive seal does not match the closure operation');
    }
    return;
  }
  const evidence = await owner.table('co_managed_participation_evidence').where(key).orderBy('evidence_id').forShare().select('evidence_id', 'payload_hash');
  const files = await owner.table('co_managed_archive_files').where(key).orderBy('archive_file_id').forShare().select('archive_file_id', 'content_hash', 'file_size');
  const manifest: CoManagedArchiveManifest = { version: 1,
    evidence: evidence.map(row => [row.evidence_id, row.payload_hash]),
    files: files.map(row => [row.archive_file_id, row.content_hash, Number(row.file_size)]) };
  await owner.table('co_managed_archive_manifests').insert({ ...identity, sealed_at: trx.raw('clock_timestamp()'), manifest,
    content_hash: coManagedArchiveManifestHash(identity, manifest) });
}
