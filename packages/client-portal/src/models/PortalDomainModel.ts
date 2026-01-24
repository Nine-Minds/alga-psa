import type { Knex } from 'knex';
import { createTenantKnex } from '@alga-psa/db';

export const PORTAL_DOMAIN_TABLE = 'portal_domains';

export const PORTAL_DOMAIN_STATUSES = [
  'pending_dns',
  'verifying_dns',
  'dns_failed',
  'pending_certificate',
  'certificate_issuing',
  'certificate_failed',
  'deploying',
  'active',
  'disabled',
] as const;

export type PortalDomainStatus = (typeof PORTAL_DOMAIN_STATUSES)[number];

export type PortalDomainVerificationMethod = 'cname';

export interface PortalDomainRecord {
  id: string;
  tenant: string;
  domain: string;
  canonical_host: string;
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

  const nextAuthUrl = process.env.NEXTAUTH_URL;
  if (!nextAuthUrl) {
    return `${prefix}.portal.algapsa.com`;
  }

  try {
    const url = new URL(nextAuthUrl);
    const baseDomain = url.hostname;
    return `${prefix}.portal.${baseDomain}`;
  } catch (error) {
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

async function getTenantAndKnex(): Promise<{ knex: Knex; tenant: string }> {
  // Dynamic import to avoid circular dependencies
  const { getCurrentUser } = await import('@alga-psa/users/actions');
  const currentUser = await getCurrentUser();
  if (!currentUser?.tenant) {
    throw new Error('Tenant context is required for portal domain operations');
  }

  const { knex, tenant } = await createTenantKnex(currentUser.tenant);

  if (!tenant) {
    throw new Error('Tenant context is required for portal domain operations');
  }

  return { knex, tenant };
}

export async function getPortalDomain(knex: Knex, tenant: string): Promise<PortalDomain | null> {
  const record = await knex<PortalDomainRecord>(PORTAL_DOMAIN_TABLE).where({ tenant }).first();

  if (!record) {
    return null;
  }

  return mapRow(record);
}

export async function getPortalDomainByHostname(knex: Knex, domain: string): Promise<PortalDomain | null> {
  const normalized = normalizeHostname(domain);
  const record = await knex<PortalDomainRecord>(PORTAL_DOMAIN_TABLE).where({ domain: normalized }).first();

  return record ? mapRow(record) : null;
}

export async function getCurrentTenantPortalDomain(): Promise<PortalDomain | null> {
  const { knex, tenant } = await getTenantAndKnex();
  return getPortalDomain(knex, tenant);
}

export async function upsertPortalDomain(knex: Knex, tenant: string, input: UpsertPortalDomainInput): Promise<PortalDomain> {
  const now = knex.fn.now();
  const canonicalHost = computeCanonicalHost(tenant);
  const normalizedDomain = normalizeHostname(input.domain);
  const lastCheckedAt =
    input.lastCheckedAt === undefined ? knex.fn.now() : coerceLastCheckedAt(knex, input.lastCheckedAt);
  const payload = {
    tenant,
    domain: normalizedDomain,
    canonical_host: canonicalHost,
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

  const [record] = await knex<PortalDomainRecord>(PORTAL_DOMAIN_TABLE)
    .insert(payload)
    .onConflict('tenant')
    .merge({
      domain: payload.domain,
      canonical_host: payload.canonical_host,
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

export async function updatePortalDomain(knex: Knex, tenant: string, patch: UpdatePortalDomainInput): Promise<PortalDomain | null> {
  const updates: Record<string, unknown> = {
    updated_at: knex.fn.now(),
  };

  if (patch.domain) {
    updates.domain = normalizeHostname(patch.domain);
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
    return getPortalDomain(knex, tenant);
  }

  const [record] = await knex<PortalDomainRecord>(PORTAL_DOMAIN_TABLE).where({ tenant }).update(updates).returning('*');

  return record ? mapRow(record) : null;
}

export async function updateCurrentTenantPortalDomain(patch: UpdatePortalDomainInput): Promise<PortalDomain | null> {
  const { knex, tenant } = await getTenantAndKnex();
  return updatePortalDomain(knex, tenant, patch);
}

export async function deletePortalDomain(knex: Knex, tenant: string): Promise<void> {
  await knex<PortalDomainRecord>(PORTAL_DOMAIN_TABLE).where({ tenant }).delete();
}

export async function deleteCurrentTenantPortalDomain(): Promise<void> {
  const { knex, tenant } = await getTenantAndKnex();
  await deletePortalDomain(knex, tenant);
}

export function isTerminalStatus(status: PortalDomainStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

