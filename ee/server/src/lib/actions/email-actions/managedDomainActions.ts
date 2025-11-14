/**
 * EE-only server actions for managed email domain orchestration.
 */

'use server';

import { createTenantKnex, getCurrentTenantId, getTenantContext, runWithTenant } from 'server/src/lib/db';
import type { Knex } from 'knex';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import type { DnsRecord } from 'server/src/types/email.types';
import { enqueueManagedEmailDomainWorkflow } from '@ee/lib/email-domains/workflowClient';
import { isValidDomain } from '@ee/lib/email-domains/domainValidation';
import { hasPermission } from 'server/src/lib/auth/rbac';

const DEFAULT_REGION = process.env.RESEND_DEFAULT_REGION || 'us-east-1';
const EMAIL_SETTINGS_RESOURCE = 'ticket_settings';
type EmailDomainPermissionAction = 'read' | 'create' | 'update' | 'delete';

type TenantColumnName = 'tenant_id' | 'tenant';
let cachedTenantColumn: Promise<TenantColumnName> | null = null;

async function getEmailDomainTenantColumn(knex: Knex): Promise<TenantColumnName> {
  if (!cachedTenantColumn) {
    cachedTenantColumn = (async () => {
      if (await knex.schema.hasColumn('email_domains', 'tenant_id')) {
        return 'tenant_id';
      }
      if (await knex.schema.hasColumn('email_domains', 'tenant')) {
        return 'tenant';
      }
      throw new Error('email_domains table missing tenant identifier column');
    })();
  }

  return cachedTenantColumn;
}

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

async function ensureTenantContext(action: EmailDomainPermissionAction) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  let tenantFromContext = await getTenantContext();
  if (!tenantFromContext) {
    tenantFromContext = (await getCurrentTenantId()) ?? undefined;
  }

  if (!tenantFromContext) {
    throw new Error('Tenant context not found');
  }

  return runWithTenant(tenantFromContext, async () => {
    const { knex } = await createTenantKnex();
    const allowed = await hasPermission(user, EMAIL_SETTINGS_RESOURCE, action, knex);
    if (!allowed && user.user_type === 'client') {
      throw new Error('You do not have permission to manage managed email domains.');
    }
    // MSP/internal roles are temporarily allowed even if the granular permission has not been seeded yet.

    return { knex, tenantId: tenantFromContext };
  });
}

export async function getManagedEmailDomains(): Promise<ManagedDomainStatus[]> {
  const { knex, tenantId } = await ensureTenantContext('read');
  const tenantColumn = await getEmailDomainTenantColumn(knex);

  const rows = await knex('email_domains')
    .where({ [tenantColumn]: tenantId })
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

export async function requestManagedEmailDomain(domainName: string) {
  const { knex, tenantId } = await ensureTenantContext('create');
  const tenantColumn = await getEmailDomainTenantColumn(knex);

  const normalizedDomain = domainName.trim().toLowerCase();
  if (!isValidDomain(normalizedDomain)) {
    throw new Error('Invalid domain format');
  }

  const now = new Date();

  await knex('email_domains')
    .insert({
      [tenantColumn]: tenantId,
      domain_name: normalizedDomain,
      status: 'pending',
      created_at: now,
      updated_at: now,
    })
    .onConflict([tenantColumn, 'domain_name'])
    .merge({
      status: 'pending',
      failure_reason: null,
      updated_at: now,
    });

  const result = await enqueueManagedEmailDomainWorkflow({
    tenantId,
    domain: normalizedDomain,
    region: DEFAULT_REGION,
    trigger: 'register',
  });

  if (!result.enqueued) {
    throw new Error(`Failed to start managed domain workflow${result.error ? `: ${result.error}` : ''}`);
  }

  return { success: true, alreadyRunning: result.alreadyRunning ?? false };
}

export async function refreshManagedEmailDomain(domainName: string) {
  const { knex, tenantId } = await ensureTenantContext('update');
  const tenantColumn = await getEmailDomainTenantColumn(knex);
  const normalizedDomain = domainName.trim().toLowerCase();

  const existing = await knex('email_domains')
    .where({ [tenantColumn]: tenantId, domain_name: normalizedDomain })
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
  const { knex, tenantId } = await ensureTenantContext('delete');
  const tenantColumn = await getEmailDomainTenantColumn(knex);
  const normalizedDomain = domainName.trim().toLowerCase();

  const existing = await knex('email_domains')
    .where({ [tenantColumn]: tenantId, domain_name: normalizedDomain })
    .first();

  if (!existing) {
    throw new Error('Domain not found');
  }

  const now = new Date();
  await knex('email_domains')
    .where({ [tenantColumn]: tenantId, domain_name: normalizedDomain })
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
