import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { CoManagedClosureContext } from './relationshipClosure';
import { isCoManagedUuid, CoManagedSharedWorkError } from './sharedWorkIdentity';

/**
 * The MSP archive is a participation-evidence-only allowlist.
 *
 * Inclusion is decided by evidence CLASS (`source_type`) and, for classes that carry one, by
 * audience. A class that is not listed here is excluded, so a new message kind can never leak
 * into the archive by omission (a deny-list would). The sealed manifest records exactly which
 * evidence ids are included (the allowlist later reads page over) and, per class, how many rows
 * were excluded and why, so over-sharing and under-sharing are both reviewable after the fact.
 */
export const ARCHIVE_EVIDENCE_CLASSES = ['conversation', 'ticket_handoff', 'work_audit', 'work_snapshot', 'private_conversation'] as const;
export type CoManagedArchiveEvidenceClass = typeof ARCHIVE_EVIDENCE_CLASSES[number];

/** Every audience any archived class may carry. `internal` (customer-private) and anything unrecognised is excluded. */
export const ARCHIVE_ALLOWED_AUDIENCES = ['requester', 'shared_it', 'organization_private'] as const;
/**
 * Audiences allowed PER class, because `organization_private` is relative to whoever owns the thread:
 * - `conversation` is the shared customer thread, captured only for requester/shared_it (the MSP could read
 *   it); an `organization_private` note there belongs to the CUSTOMER, so it is never archivable.
 * - `private_conversation` is written only from the sponsor's own `co_management_private_comments`
 *   (privateParticipationEvidence.ts) with the literal label `organization_private`: the MSP's own private
 *   content, in the MSP's partition. Any other label on that class is anomalous and excluded.
 */
const AUDIENCES_BY_CLASS: Readonly<Record<string, readonly string[]>> = {
  conversation: ['requester', 'shared_it'],
  private_conversation: ['organization_private'],
};

export type CoManagedArchiveExclusionReason = 'class_not_allowlisted' | 'audience_not_allowlisted' | 'after_cutoff';

export interface CoManagedArchiveManifest {
  version: 1;
  /** Immutable evidence identity and its original full-content checksum. */
  evidence: [id: string, hash: string][];
  /** Immutable file identity, byte checksum and size; storage state can advance. */
  files: [id: string, hash: string, size: number][];
  /** Exclusions by evidence class and reason; never row content. */
  exclusions: [evidenceClass: string, reason: CoManagedArchiveExclusionReason, count: number][];
}

/** Hash a fixed ordered representation, independent of JSONB object-key order. */
export function coManagedArchiveManifestHash(identity: { tenant: string; customer_tenant: string; relationship_id: string; operation_id: string; cutoff_at: Date | string }, manifest: CoManagedArchiveManifest): string {
  return createHash('sha256').update(JSON.stringify([manifest.version, identity.tenant, identity.customer_tenant,
    identity.relationship_id, identity.operation_id, new Date(identity.cutoff_at).toISOString(), manifest.evidence, manifest.files, manifest.exclusions])).digest('hex');
}

export interface CoManagedArchiveCandidate { evidence_id: string; payload_hash: string; source_type: string; occurred_at: Date | string; payload: any }

/** Pure classification: the one rule deciding what an MSP archive may hold. */
export function classifyArchiveCandidate(row: CoManagedArchiveCandidate, cutoffAt: Date): { include: true } | { include: false; reason: CoManagedArchiveExclusionReason } {
  if (!(ARCHIVE_EVIDENCE_CLASSES as readonly string[]).includes(row.source_type)) return { include: false, reason: 'class_not_allowlisted' };
  if (new Date(row.occurred_at).getTime() > cutoffAt.getTime()) return { include: false, reason: 'after_cutoff' };
  if (row.source_type in AUDIENCES_BY_CLASS) {
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    if (!(AUDIENCES_BY_CLASS[row.source_type] ?? []).includes(payload?.audience)) return { include: false, reason: 'audience_not_allowlisted' };
  }
  return { include: true };
}

/**
 * A source of retained archive files. This is the documented extension point for a future retained-file
 * store (L4a / L5); NOTHING registers one in production today, so `manifest.files` is always empty and the
 * bytes route has nothing to serve. Do not list a class here that `co_managed_participation_evidence.source_type`
 * does not accept. The seal only needs identity, hash and size. */
export interface CoManagedArchiveFileSource {
  name: string;
  list(trx: Knex.Transaction, key: { sponsorTenant: string; customerTenant: string; relationshipId: string }): Promise<Array<{ id: string; hash: string; size: number }>>;
  /** Open one retained file for the bytes route. The caller has already proven the id is in a sealed manifest. */
  open?(db: Knex, sponsorTenant: string, archiveFileId: string): Promise<CoManagedArchiveFileContent | null>;
}
export interface CoManagedArchiveFileContent { fileName: string; mimeType: string; size: number; body: ReadableStream<Uint8Array> | Uint8Array }
const fileSources = new Map<string, CoManagedArchiveFileSource>();
/** Idempotent per name; returns an unregister function. */
export function registerCoManagedArchiveFileSource(source: CoManagedArchiveFileSource): () => void {
  fileSources.set(source.name, source);
  return () => { if (fileSources.get(source.name) === source) fileSources.delete(source.name); };
}
export function coManagedArchiveFileSources(): CoManagedArchiveFileSource[] { return [...fileSources.values()]; }

/** Closure calls this after its evidence finalizers while retaining the exclusive relationship
 * lock. Only already-owned retained rows enter the seal; this never revisits customer content
 * or waits for a remote storage worker. Replaying the same operation verifies and returns. */
export async function sealCoManagedArchive(context: CoManagedClosureContext): Promise<void> {
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
  const rows: CoManagedArchiveCandidate[] = await owner.table('co_managed_participation_evidence').where(key).orderBy('evidence_id').forShare()
    .select('evidence_id', 'payload_hash', 'source_type', 'occurred_at', 'payload');
  const evidence: CoManagedArchiveManifest['evidence'] = [];
  const excluded = new Map<string, number>();
  for (const row of rows) {
    const decision = classifyArchiveCandidate(row, cutoffAt);
    if (decision.include) evidence.push([row.evidence_id, row.payload_hash]);
    else excluded.set(`${row.source_type}\u0000${decision.reason}`, (excluded.get(`${row.source_type}\u0000${decision.reason}`) ?? 0) + 1);
  }
  const files: CoManagedArchiveManifest['files'] = [];
  for (const source of coManagedArchiveFileSources()) {
    for (const file of await source.list(trx, { sponsorTenant, customerTenant, relationshipId })) files.push([file.id, file.hash, Number(file.size)]);
  }
  files.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  const exclusions = [...excluded.entries()].sort(([a], [b]) => a < b ? -1 : 1).map(([composite, count]) => {
    const [evidenceClass, reason] = composite.split('\u0000');
    return [evidenceClass, reason as CoManagedArchiveExclusionReason, count] as CoManagedArchiveManifest['exclusions'][number];
  });
  const manifest: CoManagedArchiveManifest = { version: 1, evidence, files, exclusions };
  // write-admission: exempt — sealed as part of the closure that ends the relationship; append-only.
  await owner.table('co_managed_archive_manifests').insert({ ...identity, sealed_at: trx.raw('clock_timestamp()'), manifest,
    content_hash: coManagedArchiveManifestHash(identity, manifest) });
}
