import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { isCoManagedUuid } from '../../../../../packages/co-managed/src/sharedWorkIdentity';
import { assertPortableRestoreInstallationAuthority } from './portableRestoreInstallationAuthority';

const TABLE = 'portable_workspace_restore_uploads';
const fail = (): never => { throw new Error('Portable restore upload recovery rejected'); };
interface RecoveryProvider { getLocationIdentity?(): string; delete(path: string): Promise<void> }
export interface PortableRestoreUploadAttempt { tenant: string; attemptId: string; providerIdentity: string }
interface UploadRow {
  tenant: string; attempt_id: string; package_id: string; archive_sha256: string; provider_identity: string;
  file_ids: string[]; status: 'uploading' | 'committed' | 'abandoned'; expires_at: Date; next_cleanup_at: Date;
}
export function portableRestoreProviderIdentity(provider: Pick<RecoveryProvider, 'getLocationIdentity'>) {
  const identity = provider.getLocationIdentity?.();
  if (typeof identity !== 'string' || !/^[a-f0-9]{64}$/.test(identity)) return fail();
  return identity;
}
function validate(row: UploadRow) {
  if (![row.tenant, row.attempt_id, row.package_id].every(isCoManagedUuid) || !/^[a-f0-9]{64}$/.test(row.provider_identity) ||
      !/^[a-f0-9]{64}$/.test(row.archive_sha256) || !Array.isArray(row.file_ids) || row.file_ids.length > 100_000 ||
      row.file_ids.some(id => !isCoManagedUuid(id)) || new Set(row.file_ids).size !== row.file_ids.length) fail();
}
const objectPath = (row: UploadRow, fileId: string) => `${row.tenant}/portable-restores/${row.attempt_id}/${fileId}`;
async function lock(trx: Knex.Transaction, tenant: string) {
  await assertPortableRestoreInstallationAuthority(trx);
  await trx.raw('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [`portable-restore:${tenant}`]);
}
async function referenced(trx: Knex.Transaction, row: UploadRow) {
  const own = tenantDb(trx, row.tenant);
  for (let offset = 0; offset < row.file_ids.length; offset += 500) {
    const paths = row.file_ids.slice(offset, offset + 500).flatMap(id => [objectPath(row, id), `/${objectPath(row, id)}`]);
    // A native copy can refer to the same object with another file identity.
    // The object path, rather than its original ID, determines deletion safety.
    if (await own.table('external_files').whereIn('storage_path', paths).first('file_id')) return true;
  }
  return false;
}

/** Record every possible attempt-owned key before making a provider write.
 * No source data, passwords, provider credentials or caller-supplied paths are
 * retained. A fixed deadline exceeds the transfer's maximum 30-minute lifetime. */
export async function beginPortableRestoreUpload(db: Knex, input: {
  tenant: string; packageId: string; archiveSha256: string; fileIds: readonly string[];
}, provider: Pick<RecoveryProvider, 'getLocationIdentity'>): Promise<PortableRestoreUploadAttempt> {
  if (db.isTransaction) fail();
  const row = { tenant: input.tenant.toLowerCase(), attempt_id: randomUUID(), package_id: input.packageId.toLowerCase(),
    archive_sha256: input.archiveSha256, provider_identity: portableRestoreProviderIdentity(provider), file_ids: [...input.fileIds].map(id => id.toLowerCase()) } as UploadRow;
  validate(row);
  await db.transaction(async trx => {
    await lock(trx, row.tenant);
    await tenantDb(trx, row.tenant).table(TABLE).insert({ ...row, file_ids: JSON.stringify(row.file_ids) });
  });
  return { tenant: row.tenant, attemptId: row.attempt_id, providerIdentity: row.provider_identity };
}

/** Commit this fence in the same transaction as native records and the restore
 * receipt. An expired or abandoned attempt cannot become a live workspace. */
export async function commitPortableRestoreUpload(trx: Knex.Transaction, attempt: PortableRestoreUploadAttempt,
  files: readonly Record<string, unknown>[]) {
  if (!trx.isTransaction || !isCoManagedUuid(attempt.tenant) || !isCoManagedUuid(attempt.attemptId)) fail();
  await lock(trx, attempt.tenant);
  const own = tenantDb(trx, attempt.tenant);
  const row = await own.table(TABLE).where({ attempt_id: attempt.attemptId, provider_identity: attempt.providerIdentity, status: 'uploading' })
    .where('expires_at', '>', trx.raw('clock_timestamp()')).forUpdate().first() as UploadRow | undefined;
  if (!row) fail(); validate(row!);
  const expected = new Map(row!.file_ids.map(id => [id, objectPath(row!, id)]));
  if (files.length !== expected.size || new Set(files.map(file => file.file_id)).size !== files.length ||
      files.some(file => expected.get(String(file.file_id)) !== file.storage_path)) fail();
  for (let offset = 0; offset < row!.file_ids.length; offset += 500) {
    const ids = row!.file_ids.slice(offset, offset + 500);
    const actual = await own.table('external_files').whereIn('file_id', ids).forShare().select('file_id', 'storage_path');
    if (actual.length !== ids.length || actual.some(file => expected.get(file.file_id) !== file.storage_path)) fail();
  }
  const receipt = await own.table('portable_workspace_restores').first('package_id', 'archive_sha256');
  if (!receipt || receipt.package_id !== row!.package_id || receipt.archive_sha256 !== row!.archive_sha256) fail();
  await own.table(TABLE).where('attempt_id', attempt.attemptId).update({ status: 'committed', cleanup_claim: null, cleanup_error_code: null });
}

/** Resolve uncertain COMMIT before cleanup. A positive result means objects
 * must be retained. Failures also require retention by the caller; an expired
 * uncommitted row remains available to installation maintenance. */
export async function settlePortableRestoreUpload(db: Knex, attempt: PortableRestoreUploadAttempt): Promise<boolean> {
  if (db.isTransaction || !isCoManagedUuid(attempt.tenant) || !isCoManagedUuid(attempt.attemptId)) fail();
  return db.transaction(async trx => {
    await lock(trx, attempt.tenant);
    const own = tenantDb(trx, attempt.tenant), row = await own.table(TABLE).where({ attempt_id: attempt.attemptId, provider_identity: attempt.providerIdentity })
      .forUpdate().first() as UploadRow | undefined;
    if (!row) fail(); validate(row!);
    if (row!.status === 'committed' || await referenced(trx, row!)) return true;
    await own.table(TABLE).where('attempt_id', attempt.attemptId).update({ status: 'abandoned', next_cleanup_at: trx.raw('clock_timestamp()') });
    return false;
  });
}

/** Installation maintenance over one explicitly identified destination, even
 * when tenant creation never committed or that tenant was later deleted.
 * Claim/fence is transactional; provider I/O is outside database locks.
 * Abandoned tombstones are revisited daily because a crashed request may leave
 * a provider write that finishes after an earlier successful cleanup. */
export async function cleanupPortableRestoreUploads(db: Knex, tenant: string, provider: RecoveryProvider, limit = 20) {
  if (db.isTransaction || !isCoManagedUuid(tenant) || !Number.isInteger(limit) || limit < 1 || limit > 100) fail();
  tenant = tenant.toLowerCase(); const identity = portableRestoreProviderIdentity(provider);
  await assertPortableRestoreInstallationAuthority(db);
  const own = tenantDb(db, tenant), due = await own.table(TABLE).where('provider_identity', identity).whereIn('status', ['uploading', 'abandoned'])
    .where('next_cleanup_at', '<=', db.raw('clock_timestamp()')).orderBy('next_cleanup_at').limit(limit).select('attempt_id');
  const result = { cleaned: 0, failed: 0, skipped: 0 };
  for (const candidate of due) {
    const claim = randomUUID();
    const row = await db.transaction(async trx => {
      await lock(trx, tenant);
      const current = await tenantDb(trx, tenant).table(TABLE).where({ attempt_id: candidate.attempt_id, provider_identity: identity })
        .whereIn('status', ['uploading', 'abandoned']).where('next_cleanup_at', '<=', trx.raw('clock_timestamp()')).forUpdate().first() as UploadRow | undefined;
      if (!current) return; validate(current);
      const now = new Date((await trx.select({ at: trx.raw('clock_timestamp()') }).first()).at);
      if (current.status === 'uploading' && new Date(current.expires_at) > now) {
        await tenantDb(trx, tenant).table(TABLE).where('attempt_id', current.attempt_id).update({ next_cleanup_at: current.expires_at });
        return;
      }
      if (await referenced(trx, current)) {
        await tenantDb(trx, tenant).table(TABLE).where('attempt_id', current.attempt_id).update({
          next_cleanup_at: trx.raw("clock_timestamp() + interval '1 day'"), cleanup_error_code: 'native_reference_retained' });
        return;
      }
      await tenantDb(trx, tenant).table(TABLE).where('attempt_id', current.attempt_id).update({ status: 'abandoned', cleanup_claim: claim,
        cleanup_attempts: trx.raw('cleanup_attempts + 1'), next_cleanup_at: trx.raw("clock_timestamp() + interval '10 minutes'") });
      return current;
    });
    if (!row) { result.skipped++; continue; }
    let failed = false;
    try {
      for (const fileId of row.file_ids) {
        if (portableRestoreProviderIdentity(provider) !== identity) fail();
        await provider.delete(objectPath(row, fileId));
      }
    } catch { failed = true; }
    await db.transaction(async trx => {
      await assertPortableRestoreInstallationAuthority(trx);
      await tenantDb(trx, tenant).table(TABLE).where({ attempt_id: row.attempt_id, status: 'abandoned', cleanup_claim: claim })
        .update({ cleanup_claim: null, cleanup_error_code: failed ? 'portable_restore_cleanup_failed' : null,
          ...(failed ? {} : { cleaned_at: trx.raw('clock_timestamp()') }),
          next_cleanup_at: trx.raw(failed ? "clock_timestamp() + interval '1 minute'" : "clock_timestamp() + interval '1 day'") });
    });
    if (failed) result.failed++; else result.cleaned++;
  }
  return result;
}

/** Explicit installation-wide maintenance also covers destinations whose
 * creation never committed. A normal tenant enumeration would miss them. */
export async function cleanupPortableRestoreUploadsForInstallation(db: Knex, provider: RecoveryProvider, limit = 20) {
  if (db.isTransaction || !Number.isInteger(limit) || limit < 1 || limit > 100) fail();
  await assertPortableRestoreInstallationAuthority(db);
  const identity = portableRestoreProviderIdentity(provider);
  // Cross-tenant journal enumeration is confined to actual installation-owner
  // maintenance. Rows contain only attempted destinations and allocated IDs.
  const destinations = await db(TABLE).where('provider_identity', identity).whereIn('status', ['uploading', 'abandoned'])
    .where('next_cleanup_at', '<=', db.raw('clock_timestamp()')).select('tenant').min('next_cleanup_at as next')
    .groupBy('tenant').orderBy('next').limit(limit);
  const result = { destinations: 0, cleaned: 0, failed: 0, skipped: 0 };
  for (const destination of destinations) {
    const current = await cleanupPortableRestoreUploads(db, destination.tenant, provider, limit);
    result.destinations++; result.cleaned += current.cleaned; result.failed += current.failed; result.skipped += current.skipped;
  }
  return result;
}
