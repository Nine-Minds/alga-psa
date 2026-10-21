import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { createTenantKnex } from 'server/src/lib/db';

export const PORTAL_DOMAIN_TABLE = 'portal_domains';
const PORTAL_DOMAIN_HOSTNAME_DISCOVERY_TENANT = '__portal_domain_hostname_discovery__';
const PORTAL_DOMAIN_HOSTNAME_DISCOVERY_REASON = 'Tenant discovery by portal hostname before tenant context exists';

const portalDomainsQuery = (knex: Knex, tenant: string) =>
  tenantDb(knex, tenant).table<PortalDomainRecord>(PORTAL_DOMAIN_TABLE);

export const PORTAL_DOMAIN_STATUSES = [
  'pending_dns',
  'verifying_dns',
  'dns_failed',
  'pending_certificate',
  'certificate_issuing',
  'certificate_failed',
  'deploying',
  'pending_redirect_uri',
  'active',
  'disabled',
] as const;

export type PortalDomainStatus = (typeof PORTAL_DOMAIN_STATUSES)[number];

// LEVERAGE: pattern portal-domain-model-copies — PortalDomainModel is duplicated in server, tenancy, client-portal and auth; the surface type/consts below are copied into each.
export const PORTAL_DOMAIN_SURFACES = ['client_portal', 'msp', 'both'] as const;

/** Which app(s) a custom domain serves: the client portal, the MSP app, or both (split by path prefix). */
export type PortalDomainSurface = (typeof PORTAL_DOMAIN_SURFACES)[number];

export const DEFAULT_PORTAL_DOMAIN_SURFACE: PortalDomainSurface = 'client_portal';

export function isPortalDomainSurface(value: unknown): value is PortalDomainSurface {
  return typeof value === 'string' && (PORTAL_DOMAIN_SURFACES as readonly string[]).includes(value);
}

export type PortalDomainVerificationMethod = 'cname';

export interface PortalDomainRecord {
  id: string;
  tenant: string;
  domain: string;
  canonical_host: string;
  surface: PortalDomainSurface;
  status: PortalDomainStatus;
  status_message: string | null;
  last_checked_at: Date | null;
  verification_method: PortalDomainVerificationMethod;
  verification_details: Record<string, unknown>;
  certificate_secret_name: string | null;
  last_synced_resource_version: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface PortalDomain {
  id: string;
  tenant: string;
  domain: string;
  canonicalHost: string;
  surface: PortalDomainSurface;
  status: PortalDomainStatus;
  statusMessage: string | null;
  lastCheckedAt: Date | null;
  verificationMethod: PortalDomainVerificationMethod;
  verificationDetails: Record<string, unknown>;
  certificateSecretName: string | null;
  lastSyncedResourceVersion: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertPortalDomainInput {
  domain: string;
  surface?: PortalDomainSurface;
  /**
   * The surface of the row being replaced. A tenant's domain keeps one row per
   * (tenant, surface); changing the surface of an existing domain must update that
   * row in place (domain uniqueness is global, so inserting a second row would collide).
   * Defaults to `surface`.
   */
  matchSurface?: PortalDomainSurface;
  status?: PortalDomainStatus;
  statusMessage?: string | null;
  verificationMethod?: PortalDomainVerificationMethod;
  verificationDetails?: Record<string, unknown>;
  lastCheckedAt?: Date | string | null;
  certificateSecretName?: string | null;
  lastSyncedResourceVersion?: string | null;
}

export interface UpdatePortalDomainInput extends Partial<Omit<UpsertPortalDomainInput, 'domain'>> {
  domain?: string;
  status?: PortalDomainStatus;
}

const TERMINAL_STATUSES: PortalDomainStatus[] = ['active', 'disabled', 'dns_failed', 'certificate_failed'];

export function getTerminalStatuses(): PortalDomainStatus[] {
  return [...TERMINAL_STATUSES];
}

export function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase();
}

export function computeCanonicalHost(tenantId: string): string {
  const safeTenantId = tenantId.trim();
  const prefix = safeTenantId.slice(0, 7) || safeTenantId;

  // Extract base domain from NEXTAUTH_URL
  const nextAuthUrl = process.env.NEXTAUTH_URL;
  if (!nextAuthUrl) {
    // Fallback to default if NEXTAUTH_URL is not set
    return `${prefix}.portal.algapsa.com`;
  }

  try {
    const url = new URL(nextAuthUrl);
    const baseDomain = url.hostname;
    return `${prefix}.portal.${baseDomain}`;
  } catch (error) {
    // Fallback to default if URL parsing fails
    console.warn('Failed to parse NEXTAUTH_URL for portal domain:', error);
    return `${prefix}.portal.algapsa.com`;
  }
}

function coerceLastCheckedAt(knex: Knex, value: Date | string | null): Date | Knex.Raw | null {
  if (value === null) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  return new Date(value);
}

function mapRow(row: PortalDomainRecord): PortalDomain {
  return {
    id: row.id,
    tenant: row.tenant,
    domain: row.domain,
    canonicalHost: row.canonical_host,
    surface: isPortalDomainSurface(row.surface) ? row.surface : DEFAULT_PORTAL_DOMAIN_SURFACE,
    status: row.status,
    statusMessage: row.status_message,
    lastCheckedAt: row.last_checked_at,
    verificationMethod: row.verification_method,
    verificationDetails: row.verification_details ?? {},
    certificateSecretName: row.certificate_secret_name,
    lastSyncedResourceVersion: row.last_synced_resource_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getTenantAndKnex(): Promise<{ knex: Knex; tenant: string }>
{
  const { knex, tenant } = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant context is required for portal domain operations');
  }

  return { knex, tenant };
}

/**
 * Names exactly one portal_domains row of a tenant. A tenant may own one row per
 * (tenant, surface), so every write must say which row it means: by `id`, or by
 * `surface`. Writes are always tenant-scoped (portalDomainsQuery) AND row-scoped.
 */
export type PortalDomainRowTarget = { id: string } | { surface: PortalDomainSurface };

function rowWhere(target: PortalDomainRowTarget): Record<string, string> {
  if (target && 'id' in target && typeof target.id === 'string' && target.id.length > 0) {
    return { id: target.id };
  }
  if (target && 'surface' in target && isPortalDomainSurface(target.surface)) {
    return { surface: target.surface };
  }
  throw new Error('Portal domain writes must target a single row (id or surface)');
}

/**
 * The tenant's domain row (oldest first, so the answer is deterministic if a tenant
 * owns more than one row). Pass `surface` to read that surface's row.
 */
export async function getPortalDomain(
  knex: Knex,
  tenant: string,
  surface?: PortalDomainSurface
): Promise<PortalDomain | null> {
  const query = surface
    ? portalDomainsQuery(knex, tenant).where({ surface })
    : portalDomainsQuery(knex, tenant).orderBy('created_at', 'asc').orderBy('id', 'asc');
  const record = await query.first() as PortalDomainRecord | undefined;

  if (!record) {
    return null;
  }

  return mapRow(record);
}

export async function getPortalDomainByHostname(knex: Knex, domain: string): Promise<PortalDomain | null> {
  const normalized = normalizeHostname(domain);
  const record = await tenantDb(knex, PORTAL_DOMAIN_HOSTNAME_DISCOVERY_TENANT)
    .unscoped<PortalDomainRecord>(PORTAL_DOMAIN_TABLE, PORTAL_DOMAIN_HOSTNAME_DISCOVERY_REASON)
    .where({ domain: normalized })
    .first();

  return record ? mapRow(record) : null;
}

export async function getCurrentTenantPortalDomain(): Promise<PortalDomain | null> {
  const { knex, tenant } = await getTenantAndKnex();
  return getPortalDomain(knex, tenant);
}

export async function upsertPortalDomain(
  knex: Knex,
  tenant: string,
  input: UpsertPortalDomainInput
): Promise<PortalDomain> {
  const now = new Date();
  const canonicalHost = computeCanonicalHost(tenant);
  const normalizedDomain = normalizeHostname(input.domain);
  const lastCheckedAt =
    input.lastCheckedAt === undefined ? now : coerceLastCheckedAt(knex, input.lastCheckedAt);
  const payload = {
    tenant,
    domain: normalizedDomain,
    canonical_host: canonicalHost,
    surface: input.matchSurface ?? input.surface ?? DEFAULT_PORTAL_DOMAIN_SURFACE,
    status: input.status ?? 'pending_dns',
    status_message: input.statusMessage ?? null,
    last_checked_at: lastCheckedAt,
    verification_method: input.verificationMethod ?? 'cname',
    verification_details: input.verificationDetails ?? {},
    certificate_secret_name: input.certificateSecretName ?? null,
    last_synced_resource_version: input.lastSyncedResourceVersion ?? null,
    created_at: now,
    updated_at: now,
  };

  const [record] = await portalDomainsQuery(knex, tenant)
    .insert(payload)
    .onConflict(['tenant', 'surface'])
    .merge({
      domain: payload.domain,
      canonical_host: payload.canonical_host,
      surface: input.surface ?? payload.surface,
      status: payload.status,
      status_message: payload.status_message,
      last_checked_at: payload.last_checked_at,
      verification_method: payload.verification_method,
      verification_details: payload.verification_details,
      certificate_secret_name: payload.certificate_secret_name,
      last_synced_resource_version: payload.last_synced_resource_version,
      updated_at: now,
    })
    .returning('*');

  return mapRow(record);
}

export async function upsertCurrentTenantPortalDomain(input: UpsertPortalDomainInput): Promise<PortalDomain> {
  const { knex, tenant } = await getTenantAndKnex();
  return upsertPortalDomain(knex, tenant, input);
}

export async function updatePortalDomain(
  knex: Knex,
  tenant: string,
  target: PortalDomainRowTarget,
  patch: UpdatePortalDomainInput
): Promise<PortalDomain | null> {
  const where = rowWhere(target);
  const updates: Record<string, unknown> = {
    updated_at: knex.fn.now(),
  };

  if (patch.domain) {
    updates.domain = normalizeHostname(patch.domain);
  }

  if (patch.surface) {
    updates.surface = patch.surface;
  }

  if (patch.status) {
    updates.status = patch.status;
  }

  if (patch.statusMessage !== undefined) {
    updates.status_message = patch.statusMessage;
  }

  if (patch.lastCheckedAt !== undefined) {
    updates.last_checked_at = coerceLastCheckedAt(knex, patch.lastCheckedAt);
  }

  if (patch.verificationMethod) {
    updates.verification_method = patch.verificationMethod;
  }

  if (patch.verificationDetails) {
    updates.verification_details = patch.verificationDetails;
  }

  if (patch.certificateSecretName !== undefined) {
    updates.certificate_secret_name = patch.certificateSecretName;
  }

  if (patch.lastSyncedResourceVersion !== undefined) {
    updates.last_synced_resource_version = patch.lastSyncedResourceVersion;
  }

  if (Object.keys(updates).length === 1) {
    const current = await portalDomainsQuery(knex, tenant).where(where).first() as PortalDomainRecord | undefined;
    return current ? mapRow(current) : null;
  }

  const [record] = await portalDomainsQuery(knex, tenant)
    .where(where)
    .update(updates)
    .returning('*') as PortalDomainRecord[];

  return record ? mapRow(record) : null;
}

export async function updateCurrentTenantPortalDomain(
  target: PortalDomainRowTarget,
  patch: UpdatePortalDomainInput
): Promise<PortalDomain | null> {
  const { knex, tenant } = await getTenantAndKnex();
  return updatePortalDomain(knex, tenant, target, patch);
}

export async function deletePortalDomain(knex: Knex, tenant: string, target: PortalDomainRowTarget): Promise<void> {
  await portalDomainsQuery(knex, tenant).where(rowWhere(target)).delete();
}

export async function deleteCurrentTenantPortalDomain(target: PortalDomainRowTarget): Promise<void> {
  const { knex, tenant } = await getTenantAndKnex();
  await deletePortalDomain(knex, tenant, target);
}

export function isTerminalStatus(status: PortalDomainStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}
