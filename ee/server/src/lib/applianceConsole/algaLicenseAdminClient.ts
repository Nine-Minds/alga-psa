/**
 * Read-only admin client for the alga-license service ("C4").
 *
 * Backs the Appliance Console read-proxy: lists/inspects appliance tenants in the
 * separate `alga_license` DB via C4's service-authed endpoints. The service secret
 * stays on the server and is never exposed to the extension/browser. Mutating
 * actions (reissue/resend/revoke/resign) go through Temporal, not this client.
 *
 * Contract mirrors `Nine-Minds/alga-license` src/api-types.ts + the planned
 * `GET /tenants` and `GET /tenants/:tenant_id` endpoints (see
 * .ai/nineminds-appliance-console-plan.md §7.1).
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export type ApplianceEdition = 'essentials' | 'pro' | 'premium';
export type ApplianceProduct = 'psa' | 'algadesk';
export type ApplianceStatus = 'registered' | 'installed' | 'active' | 'suspended' | 'cancelled';
export type InstallCodeState = 'live' | 'consumed' | 'revoked' | 'expired' | 'none';

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
  tier: 'pro' | 'premium' | null;
  seats: number | null;
  entitlement_active: boolean | null;
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

export interface ApplianceInstallCode {
  /** Last 4 chars only — full code is never returned by the read API. */
  code_masked: string;
  expires_at: number; // unix seconds
  consumed: boolean;
  revoked: boolean;
  created_at: string;
}

export interface ApplianceRecord {
  appliance_id: string;
  last_checkin_at: string | null;
  revoked: boolean;
}

export interface ApplianceEntitlement {
  stripe_sub_id: string;
  tier: 'pro' | 'premium';
  seats: number | null;
  active: boolean;
  license_sub: string | null;
  /** Presence only — the raw token is not returned on detail reads. */
  has_current_token: boolean;
}

export interface ApplianceTenantDetail {
  tenant: {
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
  };
  entitlement: ApplianceEntitlement | null;
  install_codes: ApplianceInstallCode[];
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
    let detail = '';
    try {
      const body = (await res.json()) as { error?: string; code?: string };
      detail = body.error ? ` — ${body.error}${body.code ? ` (${body.code})` : ''}` : '';
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`alga-license GET ${path} returned HTTP ${res.status}${detail}`);
  }

  return { status: res.status, data: (await res.json()) as T };
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
  return data ?? { items: [], next_cursor: null };
}

/** Fetch one appliance tenant's detail; null if the registry has no such tenant. */
export async function getApplianceTenant(tenantId: string): Promise<ApplianceTenantDetail | null> {
  const { data } = await get<ApplianceTenantDetail>(`/tenants/${encodeURIComponent(tenantId)}`);
  return data;
}
