import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { activateTenantPsaLicense, getTenantLicenseManagementScope, resolveSelfHostTier, verifyLicense } from '@alga-psa/licensing';
import { snapshotCoManagedSessionActor, lockCoManagedSessionIdentity, assertCoManagedSessionUnexpired,
  CoManagedSharedWorkError, type CoManagedSessionActor } from './sharedWorkIdentity';
import { hasCoManagedLocalPermission } from './localPermission';

/** License recovery remains available after sponsorship ends or capacity lapses.
 * Actual customer identity/permission and tenant locks are retained through the
 * entire operation; no installation identity or credential enters its result. */
async function withTenantLicenseAdmin<T>(db: Knex, input: CoManagedSessionActor,
  work: (trx: Knex.Transaction, actor: CoManagedSessionActor) => Promise<T>): Promise<T> {
  const actor = snapshotCoManagedSessionActor(input);
  return withTransaction(db, async trx => {
    if (!await tenantDb(trx, actor.tenant).table('tenants').forUpdate().first('tenant') ||
        await getTenantLicenseManagementScope(trx, actor.tenant) !== 'tenant') throw new CoManagedSharedWorkError();
    await lockCoManagedSessionIdentity(trx, actor);
    if (!await hasCoManagedLocalPermission(trx, actor, 'co_management', 'manage', true)) throw new CoManagedSharedWorkError();
    await assertCoManagedSessionUnexpired(trx, actor);
    const result = await work(trx, actor);
    await assertCoManagedSessionUnexpired(trx, actor);
    return result;
  });
}

async function readStatus(trx: Knex.Transaction, tenant: string) {
  const owner = tenantDb(trx, tenant);
  const selfHostMode = Boolean(await trx('license_state').first('id'));
  const own = await owner.table('tenant_license_state').forShare().first('license_token');
  const resolved = selfHostMode ? resolveSelfHostTier({ edition_choice: 'ee', trial_started_at: null,
    license_token: own?.license_token ?? null, license_scope: 'tenant' }, tenant) : null;
  const verified = own?.license_token ? verifyLicense(own.license_token) : null;
  return { scope: 'tenant' as const, selfHostMode, state: resolved?.state ?? null, tier: resolved?.tier ?? null,
    expiresAt: resolved?.expiresAt?.toISOString() ?? null, daysRemaining: resolved?.daysRemaining ?? null,
    customer: verified?.valid && verified.claims.aud === tenant ? verified.claims.cust : null,
    trialUsed: false, connected: false, lastCheckinAt: null, tenantId: tenant };
}

export function getCoManagedTenantLicenseStatus(db: Knex, actor: CoManagedSessionActor) {
  return withTenantLicenseAdmin(db, actor, (trx, current) => readStatus(trx, current.tenant));
}

export function submitCoManagedTenantLicense(db: Knex, actor: CoManagedSessionActor, token: string) {
  return withTenantLicenseAdmin(db, actor, async (trx, current) => {
    await activateTenantPsaLicense(trx, current.tenant, token);
    const status = await readStatus(trx, current.tenant);
    if (status.state !== 'licensed') throw new Error('A current tenant-bound PSA license is required');
    return status;
  });
}
