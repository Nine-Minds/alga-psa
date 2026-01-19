'use server';

import type { Knex } from 'knex';

import { createTenantKnex } from '@/lib/db';
import { getCurrentUser } from '@alga-psa/users/actions';
import { hasPermission } from '@alga-psa/auth';
import {
  computeCanonicalHost,
  getPortalDomain,
  updatePortalDomain,
  upsertPortalDomain,
  isTerminalStatus,
  type PortalDomainStatus,
  type UpdatePortalDomainInput,
  normalizeHostname,
  type PortalDomain,
} from 'server/src/models/PortalDomainModel';
import type {
  PortalDomainStatusResponse,
  PortalDomainRegistrationRequest,
  PortalDomainRegistrationResult,
} from '@/lib/actions/tenant-actions/portalDomain.types';
import { enqueuePortalDomainWorkflow } from '@ee/lib/portal-domains/workflowClient';
import type { IUser } from 'server/src/interfaces/auth.interfaces';
import { analytics } from '@/lib/analytics/posthog';

interface TenantContext {
  knex: Knex;
  tenant: string;
  user: IUser;
}

const REQUIRED_RESOURCE = 'settings';
const READ_ACTION = 'read';
const UPDATE_ACTION = 'update';

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function buildVerificationDetails(record: PortalDomain | null, canonicalHost: string): Record<string, unknown> {
  if (record?.verificationDetails && Object.keys(record.verificationDetails).length > 0) {
    return record.verificationDetails;
  }

  return { expected_cname: canonicalHost };
}

function createStatusResponse(record: PortalDomain | null, canonicalHost: string): PortalDomainStatusResponse {
  const statusMessage = record?.statusMessage ?? 'No custom domain registered yet.';

  return {
    domain: record?.domain ?? null,
    canonicalHost,
    status: record?.status ?? 'disabled',
    statusMessage,
    lastCheckedAt: toIsoString(record?.lastCheckedAt),
    verificationMethod: record?.verificationMethod ?? 'cname',
    verificationDetails: buildVerificationDetails(record, canonicalHost),
    certificateSecretName: record?.certificateSecretName ?? null,
    lastSyncedResourceVersion: record?.lastSyncedResourceVersion ?? null,
    createdAt: toIsoString(record?.createdAt),
    updatedAt: toIsoString(record?.updatedAt),
    isEditable: true,
    edition: 'ee',
  };
}

async function ensurePermission(action: typeof READ_ACTION | typeof UPDATE_ACTION): Promise<TenantContext> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant context is required');
  }

  if (action === UPDATE_ACTION && user.user_type === 'client') {
    throw new Error('Client portal users cannot manage custom domains.');
  }

  const allowed = await hasPermission(user, REQUIRED_RESOURCE, action, knex);
  if (!allowed) {
    throw new Error('You do not have permission to manage client portal settings.');
  }

  return { knex, tenant, user };
}

function validateRequestedDomain(rawDomain: string, canonicalHost: string): string {
  if (!rawDomain) {
    throw new Error('Domain is required.');
  }

  const normalized = normalizeHostname(rawDomain);

  if (normalized.length < 3 || normalized.length > 253) {
    throw new Error('Domain must be between 3 and 253 characters.');
  }

  if (!/^[a-z0-9.-]+$/.test(normalized)) {
    throw new Error('Domain may only include letters, numbers, hyphens, and dots.');
  }

  if (!normalized.includes('.')) {
    throw new Error('Domain must include at least one dot.');
  }

  if (normalized === canonicalHost) {
    throw new Error('Please choose a domain other than the canonical host.');
  }

  if (normalized.startsWith('.') || normalized.endsWith('.')) {
    throw new Error('Domain cannot start or end with a dot.');
  }

  return normalized;
}

async function fetchStatus(knex: Knex, tenant: string): Promise<PortalDomainStatusResponse> {
  const canonicalHost = computeCanonicalHost(tenant);
  const record = await getPortalDomain(knex, tenant);
  return createStatusResponse(record, canonicalHost);
}

export async function getPortalDomainStatusAction(): Promise<PortalDomainStatusResponse> {
  const { knex, tenant } = await ensurePermission(READ_ACTION);
  return fetchStatus(knex, tenant);
}

export async function requestPortalDomainRegistrationAction(
  request: PortalDomainRegistrationRequest
): Promise<PortalDomainRegistrationResult> {
  const { knex, tenant } = await ensurePermission(UPDATE_ACTION);

  const canonicalHost = computeCanonicalHost(tenant);
  const existing = await getPortalDomain(knex, tenant);
  const normalizedDomain = validateRequestedDomain(request.domain, canonicalHost);
  const isNewDomain = !existing;
  const domainChanged = existing ? existing.domain !== normalizedDomain : false;

  const record = await upsertPortalDomain(knex, tenant, {
    domain: normalizedDomain,
    status: 'pending_dns',
    statusMessage: domainChanged
      ? `Updating custom domain. Waiting for DNS verification of ${normalizedDomain}.`
      : `Waiting for DNS verification. Point a CNAME to ${canonicalHost}.`,
    verificationDetails: {
      expected_cname: canonicalHost,
      requested_domain: normalizedDomain,
      ...(existing && domainChanged ? { previous_domain: existing.domain } : {}),
    },
    lastCheckedAt: new Date().toISOString(),
    certificateSecretName: null,
    lastSyncedResourceVersion: null,
  });

  const workflowResult = await enqueuePortalDomainWorkflow({
    tenantId: tenant,
    portalDomainId: record.id,
    trigger: domainChanged ? 'refresh' : 'register',
  });

  analytics.capture('portal_domain.registration_enqueued', {
    tenant_id: tenant,
    domain: normalizedDomain,
    workflow_enqueued: workflowResult.enqueued,
    trigger: domainChanged ? 'refresh' : 'register',
    was_update: domainChanged,
  });

  if (!workflowResult.enqueued) {
    await updatePortalDomain(knex, tenant, {
      status: 'pending_dns',
      statusMessage: domainChanged
        ? 'Saved domain change, but failed to enqueue provisioning. Please retry or contact support.'
        : 'Saved domain, but failed to enqueue provisioning. Please try again or contact support.',
    });
  }

  const status = await fetchStatus(knex, tenant);
  return { status };
}

export async function refreshPortalDomainStatusAction(): Promise<PortalDomainStatusResponse> {
  const { knex, tenant } = await ensurePermission(READ_ACTION);
  const current = await getPortalDomain(knex, tenant);

  if (current && !isTerminalStatus(current.status)) {
    await enqueuePortalDomainWorkflow({
      tenantId: tenant,
      portalDomainId: current.id,
      trigger: 'refresh',
    }).catch(() => undefined);
  }

  const status = await fetchStatus(knex, tenant);

  analytics.capture('portal_domain.refresh', {
    tenant_id: tenant,
    status: status.status,
  });

  return status;
}

const RETRYABLE_FAILURE_STATUSES: PortalDomainStatus[] = ['dns_failed', 'certificate_failed'];

export async function retryPortalDomainRegistrationAction(): Promise<PortalDomainStatusResponse> {
  const { knex, tenant } = await ensurePermission(UPDATE_ACTION);
  const current = await getPortalDomain(knex, tenant);

  if (!current || !current.domain) {
    throw new Error('No failed custom domain registration to retry.');
  }

  if (!RETRYABLE_FAILURE_STATUSES.includes(current.status)) {
    throw new Error('Retry is only available after a failed registration.');
  }

  const now = new Date().toISOString();
  const nextStatus: UpdatePortalDomainInput = {
    lastCheckedAt: now,
  };

  if (current.status === 'dns_failed') {
    nextStatus.status = 'pending_dns';
    nextStatus.statusMessage = `Retrying DNS verification. Ensure ${current.domain} points to ${current.canonicalHost}.`;
  } else {
    nextStatus.status = 'pending_certificate';
    nextStatus.statusMessage = 'Retrying certificate provisioning. Verifying ACME challenge reachability.';
  }

  const updated = await updatePortalDomain(knex, tenant, nextStatus);

  if (updated) {
    await enqueuePortalDomainWorkflow({
      tenantId: tenant,
      portalDomainId: updated.id,
      trigger: 'refresh',
    }).catch(() => undefined);
  }

  const status = await fetchStatus(knex, tenant);

  analytics.capture('portal_domain.retry', {
    tenant_id: tenant,
    status: status.status,
    failure_status: current.status,
  });

  return status;
}

export async function disablePortalDomainAction(): Promise<PortalDomainStatusResponse> {
  const { knex, tenant } = await ensurePermission(UPDATE_ACTION);
  const existing = await getPortalDomain(knex, tenant);

  if (!existing) {
    return fetchStatus(knex, tenant);
  }

  const updated = await updatePortalDomain(knex, tenant, {
    status: 'disabled',
    statusMessage: 'Custom domain disabled by administrator.',
    lastCheckedAt: new Date().toISOString(),
    certificateSecretName: null,
    lastSyncedResourceVersion: null,
  });

  if (updated) {
    await enqueuePortalDomainWorkflow({
      tenantId: tenant,
      portalDomainId: updated.id,
      trigger: 'disable',
    }).catch(() => undefined);
  }

  const status = await fetchStatus(knex, tenant);

  analytics.capture('portal_domain.disable', {
    tenant_id: tenant,
    status: status.status,
  });

  return status;
}
