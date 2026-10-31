import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { getLicenseStateRow, verifyLicense } from '@alga-psa/licensing';

/**
 * Service-principal entitlement (Pro). The only place the limit and the default
 * rate-limit numbers live (PRD R6.1); everything else reads them from here.
 */
export const SERVICE_PRINCIPAL_ENTITLEMENT = {
  /** Flat cap on active service principals; it does not scale with seats. */
  maxPrincipals: 10,
  /** Default per-principal token bucket, which is also the ceiling an override may not exceed. */
  rateLimit: { maxTokens: 120, refillPerMin: 60 },
} as const;

/** Name of the signed license claim that carries an appliance's principal limit. */
const LICENSE_CLAIM = 'service_principals';

export const SERVICE_PRINCIPAL_LIMIT_REACHED = 'SERVICE_PRINCIPAL_LIMIT_REACHED';

export class ServicePrincipalLimitReachedError extends Error {
  public readonly statusCode = 409;
  public readonly code = SERVICE_PRINCIPAL_LIMIT_REACHED;
  public readonly limit: number;

  constructor(limit: number) {
    super(
      `You've reached your service principal limit (${limit}). Delete or deactivate a service principal to free a slot.`,
    );
    this.name = 'ServicePrincipalLimitReachedError';
    this.limit = limit;
  }
}

/**
 * Reads the numeric `service_principals` claim from a license token, but only
 * after `verifyLicense` accepted the token. The signature covers the whole
 * payload, so the decoded claim is exactly as trustworthy as `seats`. Returns
 * null for anything that is not a non-negative integer.
 */
export function readVerifiedLicenseLimit(token: string): number | null {
  const verified = verifyLicense(token);
  if (!verified.valid) return null;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    const value = payload?.[LICENSE_CLAIM];
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Where a tenant's limit comes from (PRD R6.2).
 *  - Appliance (a `license_state` row exists): ONLY the verified signed claim.
 *    `tenants.service_principal_limit` is ignored (the appliance owner controls
 *    that database). A missing claim or an unverifiable token means the Pro
 *    default, never unlimited.
 *  - Hosted: `tenants.service_principal_limit` when set, else the Pro default.
 */
export async function resolveServicePrincipalLimit(
  knex: Knex | Knex.Transaction,
  tenant: string,
): Promise<number> {
  const defaultLimit = SERVICE_PRINCIPAL_ENTITLEMENT.maxPrincipals;

  let licenseRow: Awaited<ReturnType<typeof getLicenseStateRow>> = null;
  try {
    licenseRow = await getLicenseStateRow();
  } catch {
    // license_state not readable (not migrated): this is a hosted deployment.
    licenseRow = null;
  }

  if (licenseRow) {
    if (!licenseRow.license_token) return defaultLimit;
    return readVerifiedLicenseLimit(licenseRow.license_token) ?? defaultLimit;
  }

  const row = await tenantDb(knex, tenant).table('tenants').first('service_principal_limit');
  const override = row?.service_principal_limit;
  return typeof override === 'number' && override >= 0 ? override : defaultLimit;
}

/** The ceiling for a per-principal rate-limit override: the Pro default (platform raises are out of scope here). */
export function rateLimitCeiling(): { maxTokens: number; refillPerMin: number } {
  return { ...SERVICE_PRINCIPAL_ENTITLEMENT.rateLimit };
}

/** Counts active, non-archived service users for a tenant. */
export async function countActiveServicePrincipals(
  knex: Knex | Knex.Transaction,
  tenant: string,
): Promise<number> {
  const result = await tenantDb(knex, tenant)
    .table('users')
    .where({ user_type: 'service', is_inactive: false })
    .count('* as count');
  return parseInt((result as Array<{ count: string }>)[0].count, 10);
}

export type ServicePrincipalLimitResult =
  | { ok: true; limit: number; used: number }
  | { ok: false; code: typeof SERVICE_PRINCIPAL_LIMIT_REACHED; error: string; limit: number; used: number };

export function isServicePrincipalLimitRejected(
  result: ServicePrincipalLimitResult,
): result is Extract<ServicePrincipalLimitResult, { ok: false }> {
  return result.ok === false;
}

/**
 * Run inside the same transaction as the write (R6.3). Archived principals are
 * inactive, so they never count. Never consults seats (R6.5).
 */
export async function checkServicePrincipalLimit(
  trx: Knex | Knex.Transaction,
  tenant: string,
): Promise<ServicePrincipalLimitResult> {
  const [limit, used] = await Promise.all([
    resolveServicePrincipalLimit(trx, tenant),
    countActiveServicePrincipals(trx, tenant),
  ]);
  if (used >= limit) {
    return {
      ok: false,
      code: SERVICE_PRINCIPAL_LIMIT_REACHED,
      error: new ServicePrincipalLimitReachedError(limit).message,
      limit,
      used,
    };
  }
  return { ok: true, limit, used };
}

/** Throws ServicePrincipalLimitReachedError at the limit. */
export async function assertServicePrincipalLimit(trx: Knex | Knex.Transaction, tenant: string): Promise<void> {
  const result = await checkServicePrincipalLimit(trx, tenant);
  if (isServicePrincipalLimitRejected(result)) throw new ServicePrincipalLimitReachedError(result.limit);
}
