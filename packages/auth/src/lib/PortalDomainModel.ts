import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export const PORTAL_DOMAIN_TABLE = 'portal_domains';
const PORTAL_DOMAIN_HOSTNAME_DISCOVERY_TENANT = '__portal_domain_hostname_discovery__';
const PORTAL_DOMAIN_HOSTNAME_DISCOVERY_REASON = 'Tenant discovery by portal hostname before tenant context exists';

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

export function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase();
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

export async function getPortalDomain(knex: Knex, tenant: string): Promise<PortalDomain | null> {
  const record = await tenantDb(knex, tenant).table<PortalDomainRecord>(PORTAL_DOMAIN_TABLE)
    .first() as PortalDomainRecord | undefined;

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
