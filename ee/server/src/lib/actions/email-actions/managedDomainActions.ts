/**
 * EE-only server actions for managed email domain orchestration.
 */

'use server';

import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import type { DnsRecord } from 'server/src/types/email.types';
import { enqueueManagedEmailDomainWorkflow } from '@ee/lib/email-domains/workflowClient';

const DOMAIN_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9])*$/;
const DEFAULT_REGION = process.env.RESEND_DEFAULT_REGION || 'us-east-1';

export interface ManagedDomainStatus {
  domain: string;
  status: 'pending' | 'verified' | 'failed' | string;
  providerId?: string | null;
  providerDomainId?: string | null;
  dnsRecords: DnsRecord[];
  verifiedAt?: string | null;
  failureReason?: string | null;
  updatedAt?: string | null;
}

async function ensureTenantContext() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant context not found');
  }

  return { knex, tenantId: tenant };
}

export async function getManagedEmailDomains(): Promise<ManagedDomainStatus[]> {
  const { knex, tenantId } = await ensureTenantContext();

  const rows = await knex('email_domains')
    .where({ tenant_id: tenantId })
    .orderBy('created_at', 'desc');

  return rows.map((row: any) => {
    const parsedRecords: DnsRecord[] = row.dns_records
      ? Array.isArray(row.dns_records)
        ? row.dns_records
        : JSON.parse(row.dns_records)
      : [];

    return {
      domain: row.domain_name,
      status: row.status,
      providerId: row.provider_id,
      providerDomainId: row.provider_domain_id,
      dnsRecords: parsedRecords,
      verifiedAt: row.verified_at ? new Date(row.verified_at).toISOString() : null,
      failureReason: row.failure_reason,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    } as ManagedDomainStatus;
  });
}

export async function requestManagedEmailDomain(domainName: string, region?: string) {
  const { knex, tenantId } = await ensureTenantContext();

  const normalizedDomain = domainName.trim().toLowerCase();
  if (!DOMAIN_REGEX.test(normalizedDomain)) {
    throw new Error('Invalid domain format');
  }

  const now = new Date();

  await knex('email_domains')
    .insert({
      tenant_id: tenantId,
      domain_name: normalizedDomain,
      status: 'pending',
      created_at: now,
      updated_at: now,
    })
    .onConflict(['tenant_id', 'domain_name'])
    .merge({
      status: 'pending',
      failure_reason: null,
      updated_at: now,
    });

  const result = await enqueueManagedEmailDomainWorkflow({
    tenantId,
    domain: normalizedDomain,
    region: region || DEFAULT_REGION,
    trigger: 'register',
  });

  if (!result.enqueued) {
    throw new Error(`Failed to start managed domain workflow${result.error ? `: ${result.error}` : ''}`);
  }

  return { success: true, alreadyRunning: result.alreadyRunning ?? false };
}

export async function refreshManagedEmailDomain(domainName: string) {
  const { knex, tenantId } = await ensureTenantContext();
  const normalizedDomain = domainName.trim().toLowerCase();

  const existing = await knex('email_domains')
    .where({ tenant_id: tenantId, domain_name: normalizedDomain })
    .first();

  if (!existing) {
    throw new Error('Domain not found');
  }

  const result = await enqueueManagedEmailDomainWorkflow({
    tenantId,
    domain: normalizedDomain,
    providerDomainId: existing.provider_domain_id || undefined,
    trigger: 'refresh',
  });

  if (!result.enqueued) {
    throw new Error(`Failed to refresh domain status${result.error ? `: ${result.error}` : ''}`);
  }

  return { success: true, alreadyRunning: result.alreadyRunning ?? false };
}

export async function deleteManagedEmailDomain(domainName: string) {
  const { knex, tenantId } = await ensureTenantContext();
  const normalizedDomain = domainName.trim().toLowerCase();

  const existing = await knex('email_domains')
    .where({ tenant_id: tenantId, domain_name: normalizedDomain })
    .first();

  if (!existing) {
    throw new Error('Domain not found');
  }

  const now = new Date();
  await knex('email_domains')
    .where({ tenant_id: tenantId, domain_name: normalizedDomain })
    .update({
      status: 'deleting',
      updated_at: now,
    });

  const result = await enqueueManagedEmailDomainWorkflow({
    tenantId,
    domain: normalizedDomain,
    providerDomainId: existing.provider_domain_id || undefined,
    trigger: 'delete',
  });

  if (!result.enqueued) {
    throw new Error(`Failed to delete managed domain${result.error ? `: ${result.error}` : ''}`);
  }

  return { success: true };
}
