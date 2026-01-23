import type { Knex } from 'knex';

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

export function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase();
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

