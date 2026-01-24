/**
 * EE-only server actions for managed email domain orchestration.
 */

'use server';

import { createTenantKnex } from '@/lib/db';
import type { Knex } from 'knex';
import type { DnsRecord, DnsLookupResult } from '@alga-psa/types';
import { enqueueManagedEmailDomainWorkflow } from '@ee/lib/email-domains/workflowClient';
import { isValidDomain } from '@ee/lib/email-domains/domainValidation';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { observabilityLogger } from '@/lib/observability/logging';
import type { IUser } from 'server/src/interfaces/auth.interfaces';

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

function logWorkflowEnqueueFailure(params: {
  operation: 'register' | 'refresh' | 'delete';
  tenantId: string;
  domain: string;
  providerDomainId?: string;
  workflowError?: string;
}) {
  observabilityLogger.error('Failed to enqueue managed email domain workflow', undefined, {
    event_type: 'managed_email_domain_workflow_enqueue_failed',
    managed_email_domain_operation: params.operation,
    tenant_id: params.tenantId,
    domain: params.domain,
    provider_domain_id: params.providerDomainId,
    enqueue_error: params.workflowError,
  });
}

export interface ManagedDomainStatus {
  domain: string;
  status: 'pending' | 'verified' | 'failed' | string;
  providerId?: string | null;
  providerDomainId?: string | null;
  dnsRecords: DnsRecord[];
  dnsLookupResults?: DnsLookupResult[];
  dnsLastCheckedAt?: string | null;
  verifiedAt?: string | null;
  failureReason?: string | null;
  updatedAt?: string | null;
}

async function checkEmailDomainPermission(
  user: IUser,
  action: EmailDomainPermissionAction,
  knex: Knex
): Promise<void> {
  const allowed = await hasPermission(user, EMAIL_SETTINGS_RESOURCE, action, knex);
  if (!allowed && user.user_type === 'client') {
    throw new Error('You do not have permission to manage managed email domains.');
  }
  // MSP/internal roles are temporarily allowed even if the granular permission has not been seeded yet.
}

export const getManagedEmailDomains = withAuth(async (user, { tenant }): Promise<ManagedDomainStatus[]> => {
  const { knex } = await createTenantKnex();
  await checkEmailDomainPermission(user, 'read', knex);
  const tenantColumn = await getEmailDomainTenantColumn(knex);

  const rows = await knex('email_domains')
    .where({ [tenantColumn]: tenant })
    .orderBy('created_at', 'desc');

  return rows.map((row: any) => {
    const parsedRecords: DnsRecord[] = row.dns_records
      ? Array.isArray(row.dns_records)
        ? row.dns_records
        : JSON.parse(row.dns_records)
      : [];
    const parsedDnsLookup: DnsLookupResult[] = row.dns_lookup_results
      ? Array.isArray(row.dns_lookup_results)
        ? row.dns_lookup_results
        : JSON.parse(row.dns_lookup_results)
      : [];

    return {
      domain: row.domain_name,
      status: row.status,
      providerId: row.provider_id,
      providerDomainId: row.provider_domain_id,
      dnsRecords: parsedRecords,
      dnsLookupResults: parsedDnsLookup,
      dnsLastCheckedAt: row.dns_last_checked_at ? new Date(row.dns_last_checked_at).toISOString() : null,
      verifiedAt: row.verified_at ? new Date(row.verified_at).toISOString() : null,
      failureReason: row.failure_reason,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    } as ManagedDomainStatus;
  });
});

export const requestManagedEmailDomain = withAuth(async (user, { tenant }, domainName: string) => {
  const { knex } = await createTenantKnex();
  await checkEmailDomainPermission(user, 'create', knex);
  const tenantColumn = await getEmailDomainTenantColumn(knex);

  const normalizedDomain = domainName.trim().toLowerCase();
  if (!isValidDomain(normalizedDomain)) {
    throw new Error('Invalid domain format');
  }

  const now = new Date();

  await knex('email_domains')
    .insert({
      [tenantColumn]: tenant,
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

  let result: Awaited<ReturnType<typeof enqueueManagedEmailDomainWorkflow>>;
  try {
    result = await enqueueManagedEmailDomainWorkflow({
      tenantId: tenant,
      domain: normalizedDomain,
      region: DEFAULT_REGION,
      trigger: 'register',
    });
  } catch (error: any) {
    observabilityLogger.error('Error enqueueing managed email domain workflow (register)', error, {
      event_type: 'managed_email_domain_workflow_enqueue_failed',
      tenant_id: tenant,
      domain: normalizedDomain,
    });
    throw new Error('Failed to start managed domain workflow');
  }

  if (!result.enqueued) {
    logWorkflowEnqueueFailure({
      operation: 'register',
      tenantId: tenant,
      domain: normalizedDomain,
      workflowError: result.error,
    });
    throw new Error(`Failed to start managed domain workflow${result.error ? `: ${result.error}` : ''}`);
  }

  return { success: true, alreadyRunning: result.alreadyRunning ?? false };
});

export const refreshManagedEmailDomain = withAuth(async (user, { tenant }, domainName: string) => {
  const { knex } = await createTenantKnex();
  await checkEmailDomainPermission(user, 'update', knex);
  const tenantColumn = await getEmailDomainTenantColumn(knex);
  const normalizedDomain = domainName.trim().toLowerCase();

  const existing = await knex('email_domains')
    .where({ [tenantColumn]: tenant, domain_name: normalizedDomain })
    .first();

  if (!existing) {
    throw new Error('Domain not found');
  }

  let result: Awaited<ReturnType<typeof enqueueManagedEmailDomainWorkflow>>;
  try {
    result = await enqueueManagedEmailDomainWorkflow({
      tenantId: tenant,
      domain: normalizedDomain,
      providerDomainId: existing.provider_domain_id || undefined,
      trigger: 'refresh',
    });
  } catch (error: any) {
    observabilityLogger.error('Error enqueueing managed email domain workflow (refresh)', error, {
      event_type: 'managed_email_domain_workflow_enqueue_failed',
      tenant_id: tenant,
      domain: normalizedDomain,
      provider_domain_id: existing.provider_domain_id || undefined,
    });
    throw new Error('Failed to refresh domain status');
  }

  if (!result.enqueued) {
    logWorkflowEnqueueFailure({
      operation: 'refresh',
      tenantId: tenant,
      domain: normalizedDomain,
      providerDomainId: existing.provider_domain_id || undefined,
      workflowError: result.error,
    });
    throw new Error(`Failed to refresh domain status${result.error ? `: ${result.error}` : ''}`);
  }

  return { success: true, alreadyRunning: result.alreadyRunning ?? false };
});

export const deleteManagedEmailDomain = withAuth(async (user, { tenant }, domainName: string) => {
  const { knex } = await createTenantKnex();
  await checkEmailDomainPermission(user, 'delete', knex);
  const tenantColumn = await getEmailDomainTenantColumn(knex);
  const normalizedDomain = domainName.trim().toLowerCase();

  const existing = await knex('email_domains')
    .where({ [tenantColumn]: tenant, domain_name: normalizedDomain })
    .first();

  if (!existing) {
    throw new Error('Domain not found');
  }

  const now = new Date();
  await knex('email_domains')
    .where({ [tenantColumn]: tenant, domain_name: normalizedDomain })
    .update({
      status: 'deleting',
      updated_at: now,
    });

  let result: Awaited<ReturnType<typeof enqueueManagedEmailDomainWorkflow>>;
  try {
    result = await enqueueManagedEmailDomainWorkflow({
      tenantId: tenant,
      domain: normalizedDomain,
      providerDomainId: existing.provider_domain_id || undefined,
      trigger: 'delete',
    });
  } catch (error: any) {
    observabilityLogger.error('Error enqueueing managed email domain workflow (delete)', error, {
      event_type: 'managed_email_domain_workflow_enqueue_failed',
      tenant_id: tenant,
      domain: normalizedDomain,
      provider_domain_id: existing.provider_domain_id || undefined,
    });
    throw new Error('Failed to delete managed domain');
  }

  if (!result.enqueued) {
    logWorkflowEnqueueFailure({
      operation: 'delete',
      tenantId: tenant,
      domain: normalizedDomain,
      providerDomainId: existing.provider_domain_id || undefined,
      workflowError: result.error,
    });
    throw new Error(`Failed to delete managed domain${result.error ? `: ${result.error}` : ''}`);
  }

  return { success: true };
});
