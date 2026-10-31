import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { hasCoManagedLocalPermission } from './localPermission';
import { snapshotCoManagedSessionActor, lockCoManagedSessionIdentity, assertCoManagedSessionUnexpired,
  isCoManagedUuid, CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';
import { coManagedArchiveFileSources, coManagedArchiveManifestHash, type CoManagedArchiveFileContent, type CoManagedArchiveManifest } from './archiveManifest';

/**
 * Reads over a sealed archive. The sealed manifest is the allowlist: only evidence ids and file
 * ids it names can be returned, so nothing added or recaptured after the seal, and nothing the
 * allowlist excluded, is reachable even by guessing an id. No customer table is read here: after
 * the relationship ends the MSP's archive is the MSP's own retained rows.
 */
export const ARCHIVE_EVIDENCE_PAGE = 50;
export const ARCHIVE_LIST_PAGE = 25;

export interface CoManagedArchiveSummary {
  operationId: string; clientName: string | null; sealedAt: string; cutoffAt: string;
  evidenceCount: number; fileCount: number; excludedCount: number;
}
export interface CoManagedArchiveEntry {
  id: string; kind: string; event: string; occurredAt: string;
  author?: { tenant: string; kind: string; id: string | null; name: string; organization: string };
  audience: string | null; note: string | null; markdown: string | null; deleted: boolean;
  changes?: Record<string, string | null>;
  summary?: Record<string, unknown>;
}
export interface CoManagedArchiveFile { archiveFileId: string; fileName: string | null; size: number }
export interface CoManagedArchiveHistory {
  archive: CoManagedArchiveSummary; entries: CoManagedArchiveEntry[]; files: CoManagedArchiveFile[];
  exclusions: Array<{ evidenceClass: string; reason: string; count: number }>; nextPage: number | null;
}

const pageNumber = (value: number) => { if (!Number.isSafeInteger(value) || value < 0 || value > 1000000) throw new CoManagedSharedWorkError(); return value; };
const object = (value: any): Record<string, any> => typeof value === 'string' ? JSON.parse(value) : value ?? {};

async function admitReader(trx: Knex.Transaction, actor: CoManagedSessionActor) {
  await lockCoManagedSessionIdentity(trx, actor);
  if (!await hasCoManagedLocalPermission(trx, actor, 'co_management', 'read', true)) throw new CoManagedSharedWorkError();
}

async function loadManifest(trx: Knex.Transaction, tenant: string, operationId: string) {
  const row = await tenantDb(trx, tenant).table('co_managed_archive_manifests').where('operation_id', operationId).first();
  if (!row) throw new CoManagedSharedWorkError();
  const manifest = object(row.manifest) as CoManagedArchiveManifest;
  // A manifest that no longer hashes to its seal is treated as absent, never partially served.
  if (coManagedArchiveManifestHash({ tenant, customer_tenant: row.customer_tenant, relationship_id: row.relationship_id,
    operation_id: row.operation_id, cutoff_at: row.cutoff_at }, manifest) !== row.content_hash) throw new CoManagedSharedWorkError();
  return { row, manifest };
}

async function clientNameFor(trx: Knex.Transaction, tenant: string, customerTenant: string, relationshipId: string): Promise<string | null> {
  const owner = tenantDb(trx, tenant);
  const evidence = await owner.table('co_managed_participation_evidence').where({ customer_tenant: customerTenant, relationship_id: relationshipId }).first('client_id');
  if (!evidence) return null;
  const client = await owner.table('clients').where('client_id', evidence.client_id).first('client_name');
  return client?.client_name ?? null;
}

const summarize = (row: any, manifest: CoManagedArchiveManifest, clientName: string | null): CoManagedArchiveSummary => ({
  operationId: row.operation_id, clientName, sealedAt: new Date(row.sealed_at).toISOString(), cutoffAt: new Date(row.cutoff_at).toISOString(),
  evidenceCount: manifest.evidence.length, fileCount: manifest.files.length,
  excludedCount: (manifest.exclusions ?? []).reduce((sum, [, , count]) => sum + count, 0) });

/** Archives this workspace sealed, newest first. Rows are shown by client name, never by id. */
export async function listCoManagedArchives(db: Knex, inputActor: CoManagedSessionActor, inputPage = 0):
  Promise<{ items: CoManagedArchiveSummary[]; nextPage: number | null }> {
  const actor = snapshotCoManagedSessionActor(inputActor), page = pageNumber(inputPage);
  return withTransaction(db, async trx => {
    await admitReader(trx, actor);
    const owner = tenantDb(trx, actor.tenant);
    const rows = await owner.table('co_managed_archive_manifests').orderBy('sealed_at', 'desc').orderBy('operation_id')
      .offset(page * ARCHIVE_LIST_PAGE).limit(ARCHIVE_LIST_PAGE + 1);
    const items: CoManagedArchiveSummary[] = [];
    for (const row of rows.slice(0, ARCHIVE_LIST_PAGE)) {
      const { manifest } = await loadManifest(trx, actor.tenant, row.operation_id);
      items.push(summarize(row, manifest, await clientNameFor(trx, actor.tenant, row.customer_tenant, row.relationship_id)));
    }
    await assertCoManagedSessionUnexpired(trx, actor);
    return { items, nextPage: rows.length > ARCHIVE_LIST_PAGE ? page + 1 : null };
  });
}

/** One page of an archive's retained history, newest first, drawn only from the sealed allowlist. */
export async function getCoManagedArchiveHistory(db: Knex, inputActor: CoManagedSessionActor, operationId: string, inputPage = 0):
  Promise<CoManagedArchiveHistory> {
  const actor = snapshotCoManagedSessionActor(inputActor), page = pageNumber(inputPage);
  if (!isCoManagedUuid(operationId)) throw new CoManagedSharedWorkError();
  return withTransaction(db, async trx => {
    await admitReader(trx, actor);
    const { row, manifest } = await loadManifest(trx, actor.tenant, operationId);
    const owner = tenantDb(trx, actor.tenant);
    const allowed = new Map(manifest.evidence);
    const stored = await owner.table('co_managed_participation_evidence').whereIn('evidence_id', [...allowed.keys()])
      .orderBy('occurred_at', 'desc').orderBy('evidence_id').offset(page * ARCHIVE_EVIDENCE_PAGE).limit(ARCHIVE_EVIDENCE_PAGE);
    const entries: CoManagedArchiveEntry[] = [];
    for (const evidence of stored) {
      // The seal pins each row's original content hash; a row that changed since is withheld.
      if (allowed.get(evidence.evidence_id) !== evidence.payload_hash) continue;
      const payload = object(evidence.payload), deleted = payload.deleted === true;
      const entry: CoManagedArchiveEntry = { id: evidence.evidence_id, kind: evidence.source_type, event: evidence.event_type,
        occurredAt: new Date(evidence.occurred_at).toISOString(), audience: typeof payload.audience === 'string' ? payload.audience : null, deleted,
        note: !deleted && typeof payload.note === 'string' ? payload.note : null,
        markdown: !deleted && typeof payload.markdown === 'string' ? payload.markdown : null };
      if (evidence.source_type !== 'work_snapshot') entry.author = { tenant: evidence.actor_tenant, kind: evidence.actor_kind,
        id: evidence.actor_user_id ?? evidence.actor_contact_id ?? null, name: evidence.actor_name, organization: evidence.actor_organization };
      if (evidence.source_type === 'work_audit' && payload.changes) {
        entry.changes = {};
        for (const field of ['task_name', 'due_date', 'project_status_mapping_id', 'msp_assignment']) {
          const value = payload.changes[field];
          if (typeof value === 'string' || value === null) entry.changes[field] = value;
        }
      }
      if (evidence.source_type === 'work_snapshot' && payload.summary) {
        entry.summary = Object.fromEntries(Object.entries(payload.summary as Record<string, { value: unknown }>).map(([field, candidate]) => [field, candidate.value]));
      }
      entries.push(entry);
    }
    const files = page === 0 ? manifest.files.map(([archiveFileId, , size]) => ({ archiveFileId, fileName: null, size })) : [];
    await assertCoManagedSessionUnexpired(trx, actor);
    return { archive: summarize(row, manifest, await clientNameFor(trx, actor.tenant, row.customer_tenant, row.relationship_id)),
      entries, files,
      exclusions: (manifest.exclusions ?? []).map(([evidenceClass, reason, count]) => ({ evidenceClass, reason, count })),
      nextPage: manifest.evidence.length > (page + 1) * ARCHIVE_EVIDENCE_PAGE ? page + 1 : null };
  });
}

/**
 * Open one archived file for the bytes route. The id must be named by a sealed manifest of the
 * caller's own workspace; the bytes themselves stay where the file source (L4a) keeps them.
 * Returns null for anything else, so the route answers 404 by default.
 */
export async function readCoManagedArchiveFile(db: Knex, inputActor: CoManagedSessionActor, archiveFileId: string):
  Promise<CoManagedArchiveFileContent | null> {
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!isCoManagedUuid(archiveFileId)) return null;
  const sources = coManagedArchiveFileSources().filter(source => source.open);
  if (sources.length === 0) return null;
  const permitted = await withTransaction(db, async trx => {
    try { await admitReader(trx, actor); } catch (error) { if (error instanceof CoManagedSharedWorkError) return false; throw error; }
    const manifests = await tenantDb(trx, actor.tenant).table('co_managed_archive_manifests').select('operation_id');
    for (const { operation_id } of manifests) {
      const { manifest } = await loadManifest(trx, actor.tenant, operation_id).catch(() => ({ manifest: null }));
      if (manifest?.files.some(([id]) => id === archiveFileId)) { await assertCoManagedSessionUnexpired(trx, actor); return true; }
    }
    return false;
  });
  if (!permitted) return null;
  for (const source of sources) {
    const content = await source.open!(db, actor.tenant, archiveFileId);
    if (content) return content;
  }
  return null;
}
