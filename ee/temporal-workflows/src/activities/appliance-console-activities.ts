/**
 * Temporal activities behind the Appliance Console operator actions.
 *
 * Each is a thin, typed wrapper over one alga-license ("C4") admin endpoint.
 * Business sequencing (Stripe first, then C4; email after mint) lives in the
 * workflows under ../workflows/appliance-console. 4xx answers from C4 are
 * surfaced as non-retryable failures: the request is wrong, not the network.
 */

import { ApplicationFailure, Context } from '@temporalio/activity';
import { c4Get, c4Patch, c4Post, isC4ClientError, C4RequestError } from './c4-client';

const logger = () => Context.current().log;

// ── C4 shapes the workflows need (mirror alga-license src/api-types.ts) ───────

export type C4Edition = 'essentials' | 'pro' | 'premium';
export type C4Tier = 'pro' | 'premium';
export type C4TenantStatus = 'registered' | 'installed' | 'active' | 'suspended' | 'cancelled';

export interface C4TenantDetail {
  tenant: {
    tenant_id: string;
    edition: C4Edition;
    product_code: 'psa' | 'algadesk';
    status: C4TenantStatus;
    company_name: string;
    contact_name: string | null;
    contact_email: string;
    stripe_customer_id: string | null;
  };
  entitlement: {
    stripe_sub_id: string;
    tier: C4Tier;
    seats: number | null;
    active: boolean;
    kind: 'stripe' | 'comp';
    ends_at: number | null;
  } | null;
  appliances: Array<{ appliance_id: string; credential_revoked: boolean; revoked?: boolean }>;
}

function wrapC4(error: unknown): never {
  if (isC4ClientError(error)) {
    const e = error as C4RequestError;
    throw ApplicationFailure.nonRetryable(e.message, e.code ?? `c4_http_${e.status}`);
  }
  throw error;
}

async function c4<T>(fn: () => Promise<unknown>): Promise<T> {
  try {
    return (await fn()) as T;
  } catch (error) {
    return wrapC4(error);
  }
}

const enc = encodeURIComponent;

// ── Reads ─────────────────────────────────────────────────────────────────────

/** Fetch the tenant detail the workflows use to resolve stripe_sub_id, contact email and appliances. */
export async function c4GetTenantDetail(input: { tenantId: string }): Promise<C4TenantDetail> {
  const detail = await c4<C4TenantDetail>(() => c4Get(`/tenants/${enc(input.tenantId)}`));
  return {
    ...detail,
    appliances: (detail.appliances ?? []).map((a) => ({
      ...a,
      credential_revoked: a.credential_revoked ?? a.revoked ?? false,
    })),
  };
}

// ── Writes ────────────────────────────────────────────────────────────────────

export interface C4RegisterTenantInput {
  companyName: string;
  contactName?: string | null;
  contactEmail: string;
  edition: C4Edition;
  productCode: 'psa' | 'algadesk';
  seats?: number | null;
  stripeSubId?: string | null;
}

export interface C4RegisterTenantResult {
  tenant_id: string;
  install_code: string;
  download_url: string;
  expires_at: number;
}

/** POST /register-tenant: mint the registry tenant + one-time install code. */
export async function c4RegisterTenant(input: C4RegisterTenantInput): Promise<C4RegisterTenantResult> {
  logger().info('c4RegisterTenant', { contactEmail: input.contactEmail, edition: input.edition });
  return c4(() =>
    c4Post('/register-tenant', {
      company_name: input.companyName,
      contact_name: input.contactName ?? undefined,
      contact_email: input.contactEmail,
      edition: input.edition,
      product_code: input.productCode,
      stripe_sub_id: input.stripeSubId ?? undefined,
      seats: input.seats ?? undefined,
    }),
  );
}

export interface C4ReissueInstallCodeResult {
  install_code: string;
  download_url: string;
  expires_at: number;
}

/** POST /install-codes/reissue: fresh install code, prior unclaimed ones revoked. */
export async function c4ReissueInstallCode(input: { tenantId: string }): Promise<C4ReissueInstallCodeResult> {
  logger().info('c4ReissueInstallCode', { tenantId: input.tenantId });
  return c4(() => c4Post('/install-codes/reissue', { tenant_id: input.tenantId }));
}

/** POST /tenants/:id/activation-codes: fresh in-app claim code (rebind semantics). */
export async function c4MintActivationCode(input: { tenantId: string }): Promise<{ code: string; expires_at: number }> {
  logger().info('c4MintActivationCode', { tenantId: input.tenantId });
  return c4(() => c4Post(`/tenants/${enc(input.tenantId)}/activation-codes`, {}));
}

/** POST /tenants/:id/airgap-key: re-sign the offline key bound to the tenant. */
export async function c4SignAirgapKey(input: { tenantId: string }): Promise<{ jwt: string; exp: number }> {
  logger().info('c4SignAirgapKey', { tenantId: input.tenantId });
  return c4(() => c4Post(`/tenants/${enc(input.tenantId)}/airgap-key`, {}));
}

export interface C4GrantCompLicenseInput {
  tenantId: string;
  tier: C4Tier;
  seats?: number | null;
  /** Unix seconds. */
  endsAt: number;
  note: string;
}

export interface C4GrantCompLicenseResult {
  jwt: string;
  exp: number;
  license_sub: string;
  stripe_sub_id: string;
}

/** POST /tenants/:id/comp-license: time-boxed Pro with no subscription. */
export async function c4GrantCompLicense(input: C4GrantCompLicenseInput): Promise<C4GrantCompLicenseResult> {
  logger().info('c4GrantCompLicense', { tenantId: input.tenantId, endsAt: input.endsAt });
  return c4(() =>
    c4Post(`/tenants/${enc(input.tenantId)}/comp-license`, {
      tier: input.tier,
      seats: input.seats ?? undefined,
      ends_at: input.endsAt,
      note: input.note,
    }),
  );
}

export interface C4UpdateTenantEntitlementInput {
  tenantId: string;
  seats?: number | null;
  tier?: C4Tier;
}

/** PATCH /tenants/:id/entitlement: record seats/tier on the active entitlement. */
export async function c4UpdateTenantEntitlement(
  input: C4UpdateTenantEntitlementInput,
): Promise<{ stripe_sub_id: string; tier: C4Tier; seats: number | null }> {
  logger().info('c4UpdateTenantEntitlement', { tenantId: input.tenantId, seats: input.seats, tier: input.tier });
  const body: Record<string, unknown> = {};
  if (input.seats !== undefined) body.seats = input.seats;
  if (input.tier !== undefined) body.tier = input.tier;
  return c4(() => c4Patch(`/tenants/${enc(input.tenantId)}/entitlement`, body));
}

/** POST /tenants/:id/status: registry lifecycle (check-in honours suspended/cancelled). */
export async function c4SetTenantStatus(input: {
  tenantId: string;
  status: 'active' | 'suspended' | 'cancelled';
  reason?: string | null;
}): Promise<{ tenant_id: string; status: C4TenantStatus }> {
  logger().info('c4SetTenantStatus', { tenantId: input.tenantId, status: input.status });
  return c4(() => c4Post(`/tenants/${enc(input.tenantId)}/status`, { status: input.status, reason: input.reason ?? undefined }));
}

/** POST /revoke: soft-revoke an entitlement by (possibly synthetic) subscription id. */
export async function c4RevokeEntitlement(input: { stripeSubId: string }): Promise<{ revoked: boolean }> {
  logger().info('c4RevokeEntitlement', { stripeSubId: input.stripeSubId });
  return c4(() => c4Post('/revoke', { stripe_sub_id: input.stripeSubId }));
}

/** POST /tenants/:id/appliances/:appliance_id/revoke: hard credential revoke. */
export async function c4RevokeAppliance(input: {
  tenantId: string;
  applianceId: string;
  reason?: string | null;
}): Promise<{ appliance_id: string; revoked: true }> {
  logger().info('c4RevokeAppliance', { tenantId: input.tenantId, applianceId: input.applianceId });
  return c4(() =>
    c4Post(`/tenants/${enc(input.tenantId)}/appliances/${enc(input.applianceId)}/revoke`, { reason: input.reason ?? undefined }),
  );
}

export interface C4UpdateTenantInput {
  tenantId: string;
  companyName?: string;
  contactName?: string | null;
  contactEmail?: string;
}

/** PATCH /tenants/:id: registry identity fields. */
export async function c4UpdateTenant(input: C4UpdateTenantInput): Promise<C4TenantDetail['tenant']> {
  logger().info('c4UpdateTenant', { tenantId: input.tenantId });
  const body: Record<string, unknown> = {};
  if (input.companyName !== undefined) body.company_name = input.companyName;
  if (input.contactName !== undefined) body.contact_name = input.contactName;
  if (input.contactEmail !== undefined) body.contact_email = input.contactEmail;
  return c4(() => c4Patch(`/tenants/${enc(input.tenantId)}`, body));
}
