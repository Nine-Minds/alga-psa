import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import { verifyLicense, clearLicenseVerifyCache } from './verify-license';
import { isLicenseVerifyFailure } from './license-types';
import type { LicenseStateRow, SelfHostLicenseInput } from './license-state';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface TenantLicenseStateRow {
  tenant: string; license_token: string; license_id: string; seats: number | null;
  valid_until: Date; verified_at: Date; updated_at: Date;
}

/** Internal activation after the caller's current tenant-admin admission. A
 * customer stages its own paid license without changing installation licensing,
 * product identity, sponsorship, or the MSP's capacity/subscription. */
export async function activateTenantPsaLicense(trx: Knex.Transaction, tenant: string, input: string): Promise<void> {
  if (!trx.isTransaction || !uuid.test(tenant) || typeof input !== 'string' || input.length > 16384) throw new Error('Invalid tenant license activation');
  const token = input.trim(), verified = verifyLicense(token);
  if (isLicenseVerifyFailure(verified) || verified.claims.aud !== tenant || verified.claims.tier !== 'pro') throw new Error('A valid PSA license bound to this tenant is required');
  // This admin singleton selects the installation mode; its token is untouched.
  if (!await trx('license_state').first('id')) throw new Error('Tenant license activation requires self-hosted licensing');
  const owner = tenantDb(trx, tenant);
  if (!await owner.table('tenants').forUpdate().first('tenant')) throw new Error('License tenant does not exist');
  const now = new Date((await trx.select({ at: trx.raw('clock_timestamp()') }).first()).at);
  if (verified.claims.exp * 1000 <= now.getTime()) throw new Error('The tenant license has expired');
  if (verified.claims.seats !== undefined && verified.claims.seats > 2147483647) throw new Error('Tenant license seat count is too large');
  const row: TenantLicenseStateRow = { tenant, license_token: token, license_id: verified.claims.sub, seats: verified.claims.seats ?? null,
    valid_until: new Date(verified.claims.exp * 1000), verified_at: now, updated_at: now };
  await owner.table('tenant_license_state').insert(row).onConflict('tenant').merge(row);
  clearLicenseVerifyCache();
}

/** A tenant's own signed state takes precedence even if expired. Falling back
 * to the MSP's installation token would revive an independent customer's tier.
 * Transactional seat admission retains this row until its user write finishes. */
export async function getTenantSelfHostLicenseState(tenant: string, connection?: Knex): Promise<SelfHostLicenseInput | null> {
  if (!uuid.test(tenant)) throw new Error('A tenant identity is required for license resolution');
  const db = connection ?? await getAdminConnection();
  // Probe before querying so a rolling schema does not abort a caller's user
  // transaction. Other read failures propagate rather than revive a paid tier.
  if (await db.schema.hasTable('tenant_license_state')) {
    const query = tenantDb(db, tenant).table<TenantLicenseStateRow>('tenant_license_state');
    if (db.isTransaction) query.forShare();
    const own = await query.first();
    if (own) return { edition_choice: 'ee', trial_started_at: null, license_token: own.license_token };
  }
  // Retain legacy installation licensing for tenants without an independent row.
  return await db<LicenseStateRow>('license_state').orderBy('id').first() ?? null;
}

/** Paid upgrade admission reads only an independently staged tenant license.
 * The installation token and trial state can never satisfy this requirement. */
export async function retainTenantPsaLicense(trx: Knex.Transaction, tenant: string): Promise<{
  reference: string; seats: number | null; validUntil: Date;
}> {
  if (!trx.isTransaction || !uuid.test(tenant)) throw new Error('Tenant license admission requires a tenant transaction');
  const owner = tenantDb(trx, tenant);
  if (!await owner.table('tenants').forUpdate().first('tenant')) throw new Error('License tenant does not exist');
  if (!await trx('license_state').forShare().first('id')) throw new Error('Tenant license admission requires self-hosted licensing');
  const own = await owner.table<TenantLicenseStateRow>('tenant_license_state').forShare().first();
  if (!own) throw new Error('An independent paid PSA license is required');
  const verified = verifyLicense(own.license_token);
  if (isLicenseVerifyFailure(verified) || verified.claims.aud !== tenant || verified.claims.tier !== 'pro')
    throw new Error('A valid PSA license bound to this tenant is required');
  const now = new Date((await trx.select({ at: trx.raw('clock_timestamp()') }).first()).at);
  if (verified.claims.exp * 1000 <= now.getTime()) throw new Error('The tenant license has expired');
  const seats = verified.claims.seats ?? null;
  if (seats !== null && (!Number.isSafeInteger(seats) || seats < 1 || seats > 2147483647)) throw new Error('A paid PSA technician seat is required');
  return { reference: verified.claims.sub, seats, validUntil: new Date(verified.claims.exp * 1000) };
}
