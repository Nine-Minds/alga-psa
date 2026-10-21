import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

// Auth-free, next-free read primitives for portal domains. Safe to import from
// the workflow worker graph. Do not import @alga-psa/auth, next/* or React here.

export const PORTAL_DOMAIN_TABLE = 'portal_domains';
export const PORTAL_DOMAIN_HOSTNAME_DISCOVERY_TENANT = '__portal_domain_hostname_discovery__';
export const PORTAL_DOMAIN_HOSTNAME_DISCOVERY_REASON = 'Tenant discovery by portal hostname before tenant context exists';

export const portalDomainsQuery = (knex: Knex, tenant: string) =>
  tenantDb(knex, tenant).table<PortalDomainRecord>(PORTAL_DOMAIN_TABLE);

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

export function mapRow(row: PortalDomainRecord): PortalDomain {
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

export async function getPortalDomain(knex: Knex, tenant: string): Promise<PortalDomain | null> {
  const record = await portalDomainsQuery(knex, tenant).first() as PortalDomainRecord | undefined;

  if (!record) {
    return null;
  }

  return mapRow(record);
}

