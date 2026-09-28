/**
 * Admin client for the alga-license service ("C4").
 *
 * Backs the Appliance Console read-proxy (list/detail) plus the two writes the
 * Stripe lifecycle webhook needs (revoke, seat sync). Operator-initiated writes
 * do NOT go through here: they run as Temporal workflows on the worker (see
 * ee/temporal-workflows/src/activities/appliance-console-activities.ts) so
 * that retries and audit lifecycle are handled in one place.
 *
 * The service secret stays on the server and is never exposed to the
 * extension/browser. Contract mirrors `Nine-Minds/alga-license` src/api-types.ts.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export type ApplianceEdition = 'essentials' | 'pro';
export type ApplianceProduct = 'psa' | 'algadesk';
export type ApplianceStatus = 'registered' | 'installed' | 'active' | 'suspended' | 'cancelled';
export type InstallCodeState = 'live' | 'consumed' | 'revoked' | 'expired' | 'none';
export type EntitlementKind = 'stripe' | 'comp';
export type ClaimCodePurpose = 'install' | 'activation';
export type CodeState = 'live' | 'consumed' | 'revoked' | 'expired';
export type LicenseTransport = 'connected' | 'airgap' | null;

export interface ApplianceListRow {
  tenant_id: string;
  company_name: string;
  contact_email: string;
  edition: ApplianceEdition;
  product_code: ApplianceProduct;
  status: ApplianceStatus;
  registered_at: string;
  installed_at: string | null;
  /** Entitlement (paid only; null for essentials). */
  stripe_sub_id: string | null;
  tier: 'pro' | null;
  seats: number | null;
  entitlement_active: boolean | null;
  entitlement_kind: EntitlementKind | null;
  /** Unix seconds; comp entitlements only. */
  comp_ends_at: number | null;
  /** Unix seconds when the license lapses if nothing renews it. */
  license_exp: number | null;
  /** max(appliances.last_checkin_at) across the tenant's entitlement. */
  last_checkin_at: string | null;
  appliance_count: number;
  connected: boolean;
  install_code_state: InstallCodeState;
}

export interface ApplianceListResult {
  items: ApplianceListRow[];
  next_cursor: string | null;
}

export interface ApplianceCode {
  /** Last 4 chars only — full code is never returned by the read API. */
  code_masked: string;
  purpose: ClaimCodePurpose;
  state: CodeState;
  expires_at: number; // unix seconds
  consumed: boolean;
  revoked: boolean;
  created_at: string;
}

export interface ApplianceRecord {
  appliance_id: string;
  last_checkin_at: string | null;
  credential_revoked: boolean;
  /** @deprecated Same as credential_revoked. */
  revoked: boolean;
  token_exp: number | null;
  token_iat: number | null;
  token_aud: string | null;
  created_at: string;
}

export interface ApplianceEntitlement {
  stripe_sub_id: string;
  tier: 'pro';
  seats: number | null;
  active: boolean;
  kind: EntitlementKind;
  /** Unix seconds; comp entitlements only. */
  ends_at: number | null;
  note: string | null;
  license_sub: string | null;
  customer: string;
  transport: LicenseTransport;
  /** True when any non-revoked appliance holds a token, or the entitlement does. */
  has_license: boolean;
  /** @deprecated Use has_license. */
  has_current_token: boolean;
  created_at: string;
  updated_at: string;
}

export interface ApplianceTenant {
  tenant_id: string;
  edition: ApplianceEdition;
  product_code: ApplianceProduct;
  deployment_type: 'appliance' | 'hosted';
  region: string | null;
  status: ApplianceStatus;
  company_name: string;
  contact_name: string | null;
  contact_email: string;
  stripe_customer_id: string | null;
  registered_at: string;
  installed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApplianceTenantDetail {
  tenant: ApplianceTenant;
  entitlement: ApplianceEntitlement | null;
  codes: ApplianceCode[];
  /** @deprecated Same array as `codes`; kept one release for the Phase 1 console. */
  install_codes: ApplianceCode[];
  appliances: ApplianceRecord[];
}

export interface ListApplianceTenantsParams {
  query?: string;
  edition?: string;
  product_code?: string;
  status?: string;
  limit?: number;
  cursor?: string;
}

interface AlgaLicenseConfig {
  serviceUrl: string;
  serviceSecret: string;
}

/** Comp entitlements carry a synthetic id; there is no Stripe subscription behind them. */
export function isCompSubscriptionId(stripeSubId: string | null | undefined): boolean {
  return typeof stripeSubId === 'string' && stripeSubId.startsWith('comp:');
}

function normalizeLegacyTier(value: unknown): 'pro' | null {
  if (value == null) return null;
  if (value === 'pro' || value === 'premium') return 'pro';
  throw new Error(`alga-license returned unsupported appliance tier: ${String(value)}`);
}

function normalizeLegacyEdition(value: unknown): ApplianceEdition {
  if (value === 'premium' || value === 'pro') return 'pro';
  if (value === 'essentials') return 'essentials';
  throw new Error(`alga-license returned unsupported appliance edition: ${String(value)}`);
}

/**
 * Read the service secret from inline env or a Vault-rendered file, matching the
 * loader in nm-store/alga-license (ALGA_LICENSE_SERVICE_SECRET[_FILE]).
 */
function loadServiceSecret(): string {
  const inline = process.env.ALGA_LICENSE_SERVICE_SECRET;
  if (inline) return inline.trim();

  const file = process.env.ALGA_LICENSE_SERVICE_SECRET_FILE;
  if (file) {
    const resolved = resolve(file);
    if (!existsSync(resolved)) {
      throw new Error(`ALGA_LICENSE_SERVICE_SECRET_FILE not found: ${resolved}`);
    }
    return readFileSync(resolved, 'utf8').trim();
  }

  throw new Error('ALGA_LICENSE_SERVICE_SECRET (or ALGA_LICENSE_SERVICE_SECRET_FILE) is not configured');
}

function configFromEnv(): AlgaLicenseConfig {
  const serviceUrl = process.env.ALGA_LICENSE_SERVICE_URL;
  if (!serviceUrl) throw new Error('ALGA_LICENSE_SERVICE_URL is not configured');
  return { serviceUrl: serviceUrl.replace(/\/$/, ''), serviceSecret: loadServiceSecret() };
}

async function errorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; code?: string };
    return body.error ? ` — ${body.error}${body.code ? ` (${body.code})` : ''}` : '';
  } catch {
    return '';
  }
}

async function get<T>(path: string): Promise<{ status: number; data: T | null }> {
  const config = configFromEnv();
  let res: Response;
  try {
    res = await fetch(`${config.serviceUrl}${path}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${config.serviceSecret}`, accept: 'application/json' },
    });
  } catch (err) {
    throw new Error(`alga-license GET ${path} failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (res.status === 404) return { status: 404, data: null };
  if (!res.ok) {
    throw new Error(`alga-license GET ${path} returned HTTP ${res.status}${await errorDetail(res)}`);
  }

  return { status: res.status, data: (await res.json()) as T };
}

async function send<T>(method: 'POST' | 'PATCH', path: string, body: unknown): Promise<T> {
  const config = configFromEnv();
  let res: Response;
  try {
    res = await fetch(`${config.serviceUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${config.serviceSecret}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body ?? {}),
    });
  } catch (err) {
    throw new Error(`alga-license ${method} ${path} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    throw new Error(`alga-license ${method} ${path} returned HTTP ${res.status}${await errorDetail(res)}`);
  }
  return (await res.json()) as T;
}

/** Fill in Phase 2 fields when talking to a C4 that only knows the Phase 1 shape. */
export function normalizeDetail(data: ApplianceTenantDetail): ApplianceTenantDetail {
  const codes = (data.codes ?? data.install_codes ?? []) as ApplianceCode[];
  return {
    ...data,
    tenant: {
      ...data.tenant,
      edition: normalizeLegacyEdition(data.tenant.edition),
    },
    entitlement: data.entitlement
      ? {
          ...data.entitlement,
          tier: normalizeLegacyTier(data.entitlement.tier) ?? 'pro',
          kind: data.entitlement.kind ?? (isCompSubscriptionId(data.entitlement.stripe_sub_id) ? 'comp' : 'stripe'),
          has_license: data.entitlement.has_license ?? data.entitlement.has_current_token ?? false,
        }
      : null,
    codes,
    install_codes: codes,
    appliances: (data.appliances ?? []).map((a) => ({
      ...a,
      credential_revoked: a.credential_revoked ?? a.revoked ?? false,
      revoked: a.credential_revoked ?? a.revoked ?? false,
    })),
  };
}

/** List appliance registry tenants (forces deployment_type=appliance). */
export async function listApplianceTenants(
  params: ListApplianceTenantsParams = {},
): Promise<ApplianceListResult> {
  const qs = new URLSearchParams();
  qs.set('deployment_type', 'appliance');
  if (params.query) qs.set('query', params.query);
  if (params.edition) qs.set('edition', params.edition);
  if (params.product_code) qs.set('product_code', params.product_code);
  if (params.status) qs.set('status', params.status);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.cursor) qs.set('cursor', params.cursor);

  const { data } = await get<ApplianceListResult>(`/tenants?${qs.toString()}`);
  if (!data) return { items: [], next_cursor: null };
  return {
    ...data,
    items: data.items.map((item) => ({
      ...item,
      edition: normalizeLegacyEdition(item.edition),
      tier: normalizeLegacyTier(item.tier),
      entitlement_kind:
        item.entitlement_kind ?? (item.stripe_sub_id ? (isCompSubscriptionId(item.stripe_sub_id) ? 'comp' : 'stripe') : null),
      comp_ends_at: item.comp_ends_at ?? null,
      license_exp: item.license_exp ?? null,
    })),
  };
}

/** Fetch one appliance tenant's detail; null if the registry has no such tenant. */
export async function getApplianceTenant(tenantId: string): Promise<ApplianceTenantDetail | null> {
  const { data } = await get<ApplianceTenantDetail>(`/tenants/${encodeURIComponent(tenantId)}`);
  if (!data) return null;
  return normalizeDetail(data);
}

// ── Lifecycle writes (Stripe webhook → C4). Operator writes go through Temporal. ──

/** Soft-revoke the entitlement behind a Stripe subscription (idempotent in C4). */
export async function revokeApplianceEntitlement(stripeSubId: string): Promise<{ revoked: boolean }> {
  return send<{ revoked: boolean }>('POST', '/revoke', { stripe_sub_id: stripeSubId });
}

/** Record a new seat count on the tenant's active entitlement (after Stripe changed). */
export async function updateApplianceEntitlementSeats(
  tenantId: string,
  seats: number,
): Promise<{ stripe_sub_id: string; tier: string; seats: number | null }> {
  return send('PATCH', `/tenants/${encodeURIComponent(tenantId)}/entitlement`, { seats });
}
