import type { Knex } from 'knex';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth, type AuthContext } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import {
  PORTAL_DOMAIN_TABLE,
  PORTAL_DOMAIN_HOSTNAME_DISCOVERY_TENANT,
  PORTAL_DOMAIN_HOSTNAME_DISCOVERY_REASON,
  PORTAL_DOMAIN_STATUSES,
  normalizeHostname,
  computeCanonicalHost,
  mapRow,
  portalDomainsQuery,
  getPortalDomain,
} from './portalDomainRead';
import type {
  PortalDomain,
  PortalDomainRecord,
  PortalDomainStatus,
  PortalDomainVerificationMethod,
} from './portalDomainRead';

// Auth-free read primitives live in ./portalDomainRead; re-exported so existing callers keep working.
export {
  PORTAL_DOMAIN_TABLE,
  PORTAL_DOMAIN_STATUSES,
  normalizeHostname,
  computeCanonicalHost,
  getPortalDomain,
};
export type {
  PortalDomain,
  PortalDomainRecord,
  PortalDomainStatus,
  PortalDomainVerificationMethod,
};

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

function coerceLastCheckedAt(_knex: Knex, value: Date | string | null): Date | Knex.Raw | null {
  if (value === null) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  return new Date(value);
}

async function getKnexForTenant(tenant: string): Promise<{ knex: Knex; tenant: string }> {
  const { knex } = await createTenantKnex();
  return { knex, tenant };
}

export async function getPortalDomainByHostname(knex: Knex, domain: string): Promise<PortalDomain | null> {
  const normalized = normalizeHostname(domain);
  const record = await tenantDb(knex, PORTAL_DOMAIN_HOSTNAME_DISCOVERY_TENANT)
    .unscoped<PortalDomainRecord>(PORTAL_DOMAIN_TABLE, PORTAL_DOMAIN_HOSTNAME_DISCOVERY_REASON)
    .where({ domain: normalized })
    .first();

  return record ? mapRow(record) : null;
}

export const getCurrentTenantPortalDomain = withAuth(async (_user: IUserWithRoles, { tenant }: AuthContext): Promise<PortalDomain | null> => {
  const { knex } = await getKnexForTenant(tenant);
  return getPortalDomain(knex, tenant);
});

export async function upsertPortalDomain(knex: Knex, tenant: string, input: UpsertPortalDomainInput): Promise<PortalDomain> {
  const now = new Date();
  const canonicalHost = computeCanonicalHost(tenant);
  const normalizedDomain = normalizeHostname(input.domain);
  const lastCheckedAt =
    input.lastCheckedAt === undefined ? now : coerceLastCheckedAt(knex, input.lastCheckedAt);
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

  const [record] = await portalDomainsQuery(knex, tenant)
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

export const upsertCurrentTenantPortalDomain = withAuth(async (_user: IUserWithRoles, { tenant }: AuthContext, input: UpsertPortalDomainInput): Promise<PortalDomain> => {
  const { knex } = await getKnexForTenant(tenant);
  return upsertPortalDomain(knex, tenant, input);
});

export async function updatePortalDomain(
  knex: Knex,
  tenant: string,
  patch: UpdatePortalDomainInput
): Promise<PortalDomain | null> {
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

  if (patch.verificationMethod) {
    updates.verification_method = patch.verificationMethod;
  }

  if (patch.verificationDetails) {
    updates.verification_details = patch.verificationDetails;
  }

  if (patch.lastCheckedAt !== undefined) {
    updates.last_checked_at = patch.lastCheckedAt === null ? null : coerceLastCheckedAt(knex, patch.lastCheckedAt);
  }

  if (patch.certificateSecretName !== undefined) {
    updates.certificate_secret_name = patch.certificateSecretName;
  }

  if (patch.lastSyncedResourceVersion !== undefined) {
    updates.last_synced_resource_version = patch.lastSyncedResourceVersion;
  }

  const [record] = await portalDomainsQuery(knex, tenant)
    .update(updates)
    .returning('*') as PortalDomainRecord[];

  return record ? mapRow(record) : null;
}
