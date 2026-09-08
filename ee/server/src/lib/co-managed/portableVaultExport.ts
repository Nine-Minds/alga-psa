import { portableSnapshotTransaction, type CoManagedPortableSnapshot } from '../../../../../packages/co-managed/src/portableSnapshot';
import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { RequestLocalAuthorizationCache, resolveBundleNarrowingRulesForEvaluation,
  type AuthorizationSubject } from '@alga-psa/authorization';
import { withCoManagedExportAdmin } from '../../../../../packages/co-managed/src/portableExport';
import { hasCoManagedLocalPermission } from '../../../../../packages/co-managed/src/localPermission';
import { snapshotCoManagedSessionActor, isCoManagedUuid, CoManagedSharedWorkError,
  type CoManagedSessionActor } from '../../../../../packages/co-managed/src/sharedWorkIdentity';
import { buildCredentialAuthorizationKernel, toCredentialAuthorizationRecord,
  type CredentialRow, type CredentialGrantRow } from '../credentials/credentialAuthorization';
import { isCredentialEncryptionScheme } from '../credentials/encryption';
import { sealPortableCredentialVault } from '../credentials/portable';
import { writeCredentialAudit } from '../credentials/audit';

const ROW_COLUMNS = ['credential_id', 'client_id', 'name', 'username', 'url', 'description',
  'password_ciphertext', 'otp_secret_ciphertext', 'encryption_scheme', 'is_restricted', 'created_by', 'created_at', 'updated_at'];

async function collect(trx: Knex.Transaction, actor: CoManagedSessionActor, subject: AuthorizationSubject) {
  if (!await hasCoManagedLocalPermission(trx, actor, 'credential', 'read', true)) throw new CoManagedSharedWorkError();
  const own = tenantDb(trx, actor.tenant);
  const rows = await own.table<CredentialRow>('credentials').orderBy('credential_id').forShare().select(...ROW_COLUMNS);
  const grants = await own.table<CredentialGrantRow & { credential_id: string }>('credential_access_grants')
    .orderBy('credential_id').orderBy('subject_type').orderBy('subject_id').forShare()
    .select('credential_id', 'subject_type', 'subject_id', 'created_by', 'created_at');
  const associations = await own.table('credential_associations').orderBy('credential_id').orderBy('entity_type').orderBy('entity_id')
    .whereNotNull('credential_id').forShare().select('credential_id', 'entity_type', 'entity_id', 'created_at');
  const requestCache = new RequestLocalAuthorizationCache();
  const bundleNarrowingRules = await resolveBundleNarrowingRulesForEvaluation(trx, {
    subject, resource: { type: 'credential', action: 'read' }, requestCache, knex: trx,
  }, { lock: true });
  const context = { subject, bundleNarrowingRules, requestCache };
  const grantsById = new Map<string, CredentialGrantRow[]>();
  for (const grant of grants) grantsById.set(grant.credential_id, [...(grantsById.get(grant.credential_id) ?? []), grant]);
  for (const row of rows) {
    const decision = await buildCredentialAuthorizationKernel(context, row.is_restricted, trx).authorizeResource({
      knex: trx, subject, resource: { type: 'credential', action: 'read', id: row.credential_id },
      record: toCredentialAuthorizationRecord(row, grantsById.get(row.credential_id) ?? []), requestCache,
    });
    if (!isCredentialEncryptionScheme(row.encryption_scheme) || !decision.allowed || decision.redactedFields.length) throw new CoManagedSharedWorkError();
  }
  const ids = new Set(rows.map(row => row.credential_id));
  // Do not silently emit a partial vault when an association cannot be reconstructed.
  if (grants.some(row => !ids.has(row.credential_id)) || associations.some(row => !ids.has(row.credential_id))) throw new CoManagedSharedWorkError();
  return { rows, grants, associations };
}

function fingerprint(snapshot: Awaited<ReturnType<typeof collect>>) {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

/** Customer-owned native vault component for the enclosing workspace package.
 * No caller-supplied tenant or row selection is accepted. All selected entries
 * must be readable, including restricted-entry ACL and bundle checks. A changed
 * source or revoked authority during provider work aborts delivery entirely. */
export async function exportCoManagedPortableVault(db: Knex, inputActor: CoManagedSessionActor,
  packageId: string, passphrase: string, databaseSnapshot?: CoManagedPortableSnapshot) {
  if (db.isTransaction) throw new Error('Portable export requires a root database connection');
  const actor = snapshotCoManagedSessionActor(inputActor);
  if (!isCoManagedUuid(packageId)) throw new CoManagedSharedWorkError();
  const context = { packageId, sourceTenant: actor.tenant };
  const snapshot = await portableSnapshotTransaction(db, databaseSnapshot, retained => withCoManagedExportAdmin(retained, actor, async (trx, current, subject) => {
    const result = await collect(trx, current, subject);
    for (const row of result.rows) {
      const params = { userId: current.userId, credentialId: row.credential_id, clientId: row.client_id };
      const details = { purpose: 'portable_export', export_package_id: packageId };
      await writeCredentialAudit(trx, current.tenant, 'credential_reveal', params, details);
      if (row.otp_secret_ciphertext) await writeCredentialAudit(trx, current.tenant, 'credential_otp_seed_reveal', params, details);
    }
    return result;
  }));
  const original = fingerprint(snapshot);
  const assertCurrent = async (trx: Knex.Transaction) => {
    if (!trx.isTransaction) throw new Error('Portable retention requires a transaction');
    await withCoManagedExportAdmin(trx, actor, async (retained, verified, subject) => {
      if (fingerprint(await collect(retained, verified, subject)) !== original) throw new CoManagedSharedWorkError();
    });
  };
  const vault = await sealPortableCredentialVault(context, snapshot.rows.map(row => ({
    credentialId: row.credential_id, passwordCiphertext: row.password_ciphertext,
    otpSecretCiphertext: row.otp_secret_ciphertext,
    scheme: row.encryption_scheme as import('../credentials/encryption').CredentialEncryptionScheme,
  })), passphrase);
  return withCoManagedExportAdmin(db, actor, async (trx, current, subject) => {
    if (fingerprint(await collect(trx, current, subject)) !== original) throw new CoManagedSharedWorkError();
    const credentials = snapshot.rows.map(({ password_ciphertext: _password, otp_secret_ciphertext: _otp,
      encryption_scheme: _scheme, ...metadata }) => metadata);
    return { vault, credentials, grants: snapshot.grants, associations: snapshot.associations, assertCurrent };
  });
}
