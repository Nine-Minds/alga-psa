import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { verifyLicense, clearLicenseVerifyCache } from './verify-license';
import { isLicenseVerifyFailure } from './license-types';
import type { SelfHostLicenseInput } from './license-state';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TenantLicenseStateRow {
  tenant: string; license_token: string; license_id: string; seats: number | null;
  valid_until: Date; verified_at: Date; updated_at: Date;
}

/**
 * Tenant-bound signed claims are CONFIG-GATED. The issuer of such claims lives outside this
 * repository, so the verifier ships dark: with this off, every function here is inert and tier
 * resolution is exactly what it was without it (no query, no table probe).
 */
export function tenantLicenseClaimsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ALGA_TENANT_LICENSE_CLAIMS === 'enabled';
}

// One probe per process, never one per tier check (DO-NOT-PORT #14). A positive answer is
// permanent; a negative one is re-probed after a short interval so a rolling deploy that migrates
// later is picked up without a restart.
const NEGATIVE_TTL_MS = 60_000;
let tableProbe: { present: boolean; at: number } | null = null;

export function resetTenantLicenseTableProbe(): void {
  tableProbe = null;
}

async function tenantLicenseTableAvailable(db: Knex): Promise<boolean> {
  if (tableProbe && (tableProbe.present || Date.now() - tableProbe.at < NEGATIVE_TTL_MS)) return tableProbe.present;
  const present = await db.schema.hasTable('tenant_license_state');
  tableProbe = { present, at: Date.now() };
  return present;
}

/**
 * Validate and stage a tenant's own signed claim. The claim must be bound to this tenant (`aud`)
 * and be tier `pro`, and expiry is re-checked against the database clock at the point of use
 * because `verifyLicense` caches successful verifications. Never touches the installation
 * singleton `license_state`: it is only READ, to prove this is a self-hosted installation.
 */
export async function activateTenantPsaLicense(trx: Knex.Transaction, tenant: string, input: string): Promise<void> {
  if (!tenantLicenseClaimsEnabled()) throw new Error('Tenant license claims are not enabled');
  if (!trx.isTransaction || !UUID.test(tenant) || typeof input !== 'string' || input.length > 16384) {
    throw new Error('Invalid tenant license activation');
  }
  const token = input.trim();
  const verified = verifyLicense(token);
  if (isLicenseVerifyFailure(verified) || verified.claims.aud !== tenant || verified.claims.tier !== 'pro') {
    throw new Error('A valid PSA license bound to this tenant is required');
  }
  if (!await trx('license_state').first('id')) throw new Error('Tenant license activation requires self-hosted licensing');
  const owner = tenantDb(trx, tenant);
  if (!await owner.table('tenants').forUpdate().first('tenant')) throw new Error('License tenant does not exist');
  const now = new Date((await trx.select({ at: trx.raw('clock_timestamp()') }).first()).at);
  if (verified.claims.exp * 1000 <= now.getTime()) throw new Error('The tenant license has expired');
  const seats = verified.claims.seats ?? null;
  if (seats !== null && (!Number.isSafeInteger(seats) || seats < 0 || seats > 2147483647)) {
    throw new Error('Tenant license seat count is invalid');
  }
  const row: TenantLicenseStateRow = { tenant, license_token: token, license_id: verified.claims.sub, seats,
    valid_until: new Date(verified.claims.exp * 1000), verified_at: now, updated_at: now };
  // write-admission: exempt — licence state is the licensing layer's own record
  await owner.table('tenant_license_state').insert(row).onConflict('tenant').merge(row);
  clearLicenseVerifyCache();
}

/**
 * The tenant's own claim as a tier-resolution input, or null when it has none. A tenant's own
 * signed state wins over the installation token even when expired: falling back would revive an
 * independent customer's tier. Returns null (and issues no query) unless claims are enabled and
 * the table exists. Callers decide what an error means; tier resolution treats it as "no claim"
 * so its behaviour on error is unchanged from before this existed.
 */
export async function getTenantOwnLicenseInput(tenant: string, db: Knex): Promise<SelfHostLicenseInput | null> {
  if (!tenantLicenseClaimsEnabled() || !UUID.test(tenant)) return null;
  if (!await tenantLicenseTableAvailable(db)) return null;
  const query = tenantDb(db, tenant).table<TenantLicenseStateRow>('tenant_license_state');
  if (db.isTransaction) query.forShare(); // Seat admission retains the row until its write finishes.
  const own = await query.first();
  return own
    ? { edition_choice: 'ee', trial_started_at: null, license_token: own.license_token, license_scope: 'tenant' }
    : null;
}

/** Appliance controls belong to the installation owner; a workspace with its own claim, or a
 * co-managed customer workspace, manages only its own licence. */
export async function getTenantLicenseManagementScope(db: Knex, tenant: string): Promise<'tenant' | 'installation'> {
  if (!UUID.test(tenant)) throw new Error('A tenant identity is required for license management');
  const workspace = await tenantDb(db, tenant).table('tenants').first('product_code');
  if (!workspace) throw new Error('License tenant does not exist');
  if (workspace.product_code === 'co_managed') return 'tenant';
  if (tenantLicenseClaimsEnabled() && await tenantLicenseTableAvailable(db) &&
      await tenantDb(db, tenant).table('tenant_license_state').first('tenant')) return 'tenant';
  return 'installation';
}
