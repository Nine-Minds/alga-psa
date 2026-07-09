/**
 * EE-only server actions for managed email domain orchestration.
 */

'use server';

import { createTenantKnex } from '@/lib/db';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { DnsRecord, DnsLookupResult } from '@alga-psa/types';
import { assertHostedInstall, isSelfHostLicensing } from '@alga-psa/licensing';
import { enqueueManagedEmailDomainWorkflow } from '@ee/lib/email-domains/workflowClient';
import { isValidDomain } from '@ee/lib/email-domains/domainValidation';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { observabilityLogger } from 'server/src/lib/observability/logging';
import type { IUser } from 'server/src/interfaces/auth.interfaces';

const DEFAULT_REGION = process.env.RESEND_DEFAULT_REGION || 'us-east-1';
const EMAIL_SETTINGS_RESOURCE = 'ticket_settings';
type EmailDomainPermissionAction = 'read' | 'create' | 'update' | 'delete';
type ManagedDomainOperation = 'read' | 'request' | 'refresh' | 'delete';

let loggedManagedDomainConflictFallback = false;

type PostgresErrorLike = {
  code?: string;
};

function isMissingEmailDomainConflictConstraintError(error: unknown): boolean {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as PostgresErrorLike).code === '42P10';
}

function logManagedDomainConflictFallbackOnce(params: {
  tenantId: string;
  domain: string;
}) {
  if (loggedManagedDomainConflictFallback) {
    return;
  }

  loggedManagedDomainConflictFallback = true;
  observabilityLogger.warn('email_domains is missing the expected unique constraint; using manual upsert fallback', {
    event_type: 'managed_email_domain_conflict_fallback',
    tenant_id: params.tenantId,
    domain: params.domain,
    tenant_column: 'tenant',
  });
}

async function upsertManagedEmailDomainWithoutConflict(params: {
  knex: Knex;
  tenantId: string;
  domainName: string;
  record: Record<string, unknown>;
  mergeFields: Record<string, unknown>;
}): Promise<void> {
  const { knex, tenantId, domainName, record, mergeFields } = params;

  await knex.transaction(async (trx) => {
    const db = tenantDb(trx, tenantId);
    const existing = await db.table('email_domains')
      .where({ domain_name: domainName })
      .first();

    if (existing) {
      await db.table('email_domains')
        .where({ domain_name: domainName })
        .update(mergeFields);
      return;
    }

    await db.table('email_domains').insert(record);
  });
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

export type ManagedDomainActionErrorCode =
  | 'feature_unavailable'
  | 'permission_denied'
  | 'invalid_domain'
  | 'domain_not_found'
  | 'workflow_enqueue_failed';

export interface ManagedDomainActionFailure {
  success: false;
  error: string;
  code: ManagedDomainActionErrorCode;
  fieldErrors?: Record<string, string>;
}

export type ManagedDomainActionResult =
  | { success: true; alreadyRunning?: boolean }
  | ManagedDomainActionFailure;

function managedDomainActionFailureFrom(error: unknown, operation: ManagedDomainOperation): ManagedDomainActionFailure | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const code = (error as { code?: unknown }).code;
  if (code === 'TIER_ACCESS_DENIED' || code === 'HOSTING_REQUIRED') {
    return {
      success: false,
      code: 'feature_unavailable',
      error: code === 'HOSTING_REQUIRED'
        ? error.message
        : 'Managed email domains are not available for this workspace.',
    };
  }
  if (error.message === 'You do not have permission to manage managed email domains.') {
    return {
      success: false,
      code: 'permission_denied',
      error: 'You do not have permission to manage managed email domains.',
    };
  }
  if (error.message === 'Invalid domain format') {
    return {
      success: false,
      code: 'invalid_domain',
      error: 'Enter a valid domain name, such as example.com.',
      fieldErrors: { domain: 'Enter a valid domain name.' },
    };
  }
  if (error.message === 'Domain not found') {
    return {
      success: false,
      code: 'domain_not_found',
      error: 'Managed domain not found. Refresh the page and try again.',
    };
  }
  if (
    error.message.startsWith('Failed to start managed domain workflow') ||
    error.message.startsWith('Failed to refresh domain status') ||
    error.message.startsWith('Failed to delete managed domain')
  ) {
    if (operation !== 'read') {
      return managedDomainWorkflowFailure(operation);
    }
  }

  return null;
}

function managedDomainWorkflowFailure(operation: 'request' | 'refresh' | 'delete'): ManagedDomainActionFailure {
  const messageByOperation = {
    request: 'Managed domain setup could not be started. Please try again.',
    refresh: 'Managed domain verification could not be refreshed. Please try again.',
    delete: 'Managed domain removal could not be started. Please try again.',
  };

  return {
    success: false,
    code: 'workflow_enqueue_failed',
    error: messageByOperation[operation],
  };
}

async function managedDomainAction<T extends { success: true }>(
  operation: 'request' | 'refresh' | 'delete',
  action: () => Promise<T | ManagedDomainActionFailure>,
): Promise<T | ManagedDomainActionFailure> {
  try {
    return await action();
  } catch (error) {
    const expectedFailure = managedDomainActionFailureFrom(error, operation);
    if (expectedFailure) {
      return expectedFailure;
    }
    throw error;
  }
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

export const getManagedEmailDomains = withAuth(async (user, { tenant }): Promise<ManagedDomainStatus[] | ManagedDomainActionFailure> => {
  try {
    if (await isSelfHostLicensing()) {
      return [];
    }

    const { knex } = await createTenantKnex();
    await checkEmailDomainPermission(user, 'read', knex);

    const rows = await tenantDb(knex, tenant).table('email_domains')
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
  } catch (error) {
    const expectedFailure = managedDomainActionFailureFrom(error, 'read');
    if (expectedFailure) {
      return expectedFailure;
    }
    throw error;
  }
});

export const requestManagedEmailDomain = withAuth(async (user, { tenant }, domainName: string): Promise<ManagedDomainActionResult> => managedDomainAction('request', async () => {
  await assertHostedInstall('Managed email');

  const { knex } = await createTenantKnex();
  await checkEmailDomainPermission(user, 'create', knex);

  const normalizedDomain = domainName.trim().toLowerCase();
  if (!isValidDomain(normalizedDomain)) {
    throw new Error('Invalid domain format');
  }

  const now = new Date();
  const record = {
    tenant,
    domain_name: normalizedDomain,
    status: 'pending',
    created_at: now,
    updated_at: now,
  };
  const mergeFields = {
    status: 'pending',
    failure_reason: null,
    updated_at: now,
  };

  try {
    await tenantDb(knex, tenant).table('email_domains')
      .insert(record)
      .onConflict(['tenant', 'domain_name'])
      .merge(mergeFields);
  } catch (error) {
    if (!isMissingEmailDomainConflictConstraintError(error)) {
      throw error;
    }

    logManagedDomainConflictFallbackOnce({
      tenantId: tenant,
      domain: normalizedDomain,
    });
    await upsertManagedEmailDomainWithoutConflict({
      knex,
      tenantId: tenant,
      domainName: normalizedDomain,
      record,
      mergeFields,
    });
  }

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
    return managedDomainWorkflowFailure('request');
  }

  if (!result.enqueued) {
    logWorkflowEnqueueFailure({
      operation: 'register',
      tenantId: tenant,
      domain: normalizedDomain,
      workflowError: result.error,
    });
    return managedDomainWorkflowFailure('request');
  }

  return { success: true, alreadyRunning: result.alreadyRunning ?? false };
}));

export const refreshManagedEmailDomain = withAuth(async (user, { tenant }, domainName: string): Promise<ManagedDomainActionResult> => managedDomainAction('refresh', async () => {
  await assertHostedInstall('Managed email');

  const { knex } = await createTenantKnex();
  await checkEmailDomainPermission(user, 'update', knex);
  const normalizedDomain = domainName.trim().toLowerCase();

  const existing = await tenantDb(knex, tenant).table('email_domains')
    .where({ domain_name: normalizedDomain })
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
    return managedDomainWorkflowFailure('refresh');
  }

  if (!result.enqueued) {
    logWorkflowEnqueueFailure({
      operation: 'refresh',
      tenantId: tenant,
      domain: normalizedDomain,
      providerDomainId: existing.provider_domain_id || undefined,
      workflowError: result.error,
    });
    return managedDomainWorkflowFailure('refresh');
  }

  return { success: true, alreadyRunning: result.alreadyRunning ?? false };
}));

export const deleteManagedEmailDomain = withAuth(async (user, { tenant }, domainName: string): Promise<ManagedDomainActionResult> => managedDomainAction('delete', async () => {
  await assertHostedInstall('Managed email');

  const { knex } = await createTenantKnex();
  await checkEmailDomainPermission(user, 'delete', knex);
  const normalizedDomain = domainName.trim().toLowerCase();

  const db = tenantDb(knex, tenant);
  const existing = await db.table('email_domains')
    .where({ domain_name: normalizedDomain })
    .first();

  if (!existing) {
    throw new Error('Domain not found');
  }

  const now = new Date();
  await db.table('email_domains')
    .where({ domain_name: normalizedDomain })
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
    return managedDomainWorkflowFailure('delete');
  }

  if (!result.enqueued) {
    logWorkflowEnqueueFailure({
      operation: 'delete',
      tenantId: tenant,
      domain: normalizedDomain,
      providerDomainId: existing.provider_domain_id || undefined,
      workflowError: result.error,
    });
    return managedDomainWorkflowFailure('delete');
  }

  return { success: true };
}));
