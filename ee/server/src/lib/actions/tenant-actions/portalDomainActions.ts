'use server';

import type { Knex } from 'knex';

import { createTenantKnex } from '@/lib/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import {
  computeCanonicalHost,
  getPortalDomain,
  type PortalDomainStatus,
  normalizeHostname,
  type PortalDomain,
} from 'server/src/models/PortalDomainModel';
import type {
  PortalDomainStatusResponse,
  PortalDomainRegistrationRequest,
  PortalDomainRegistrationResult,
} from '@alga-psa/tenancy/actions/tenant-actions/portalDomain.types';
import { resolveDeploymentCapabilities } from '@/lib/deployment/deploymentProfile';
import { getPortalDomainProvisioner } from '@ee/lib/portal-domains/provisioner';
import type { IUser } from 'server/src/interfaces/auth.interfaces';
import { analytics } from '@/lib/analytics/posthog';

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
  const mode = resolveDeploymentCapabilities().portalDomain.provisioner;

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
    mode,
  };
}

async function checkPermission(
  user: IUser,
  action: typeof READ_ACTION | typeof UPDATE_ACTION,
  knex: Knex
): Promise<void> {
  if (action === UPDATE_ACTION && user.user_type === 'client') {
    throw new Error('Client portal users cannot manage custom domains.');
  }

  const allowed = await hasPermission(user, REQUIRED_RESOURCE, action, knex);
  if (!allowed) {
    throw new Error('You do not have permission to manage client portal settings.');
  }
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

export const getPortalDomainStatusAction = withAuth(async (user, { tenant }): Promise<PortalDomainStatusResponse> => {
  const { knex } = await createTenantKnex();
  await checkPermission(user, READ_ACTION, knex);
  return fetchStatus(knex, tenant);
});

export const requestPortalDomainRegistrationAction = withAuth(async (
  user,
  { tenant },
  request: PortalDomainRegistrationRequest
): Promise<PortalDomainRegistrationResult> => {
  const { knex } = await createTenantKnex();
  await checkPermission(user, UPDATE_ACTION, knex);

  const canonicalHost = computeCanonicalHost(tenant);
  const existing = await getPortalDomain(knex, tenant);
  const normalizedDomain = validateRequestedDomain(request.domain, canonicalHost);
  const domainChanged = existing ? existing.domain !== normalizedDomain : false;

  const provisioner = getPortalDomainProvisioner();
  const { enqueued } = await provisioner.register({
    knex,
    tenant,
    canonicalHost,
    domain: normalizedDomain,
    existing,
    domainChanged,
  });

  analytics.capture('portal_domain.registration_enqueued', {
    tenant_id: tenant,
    domain: normalizedDomain,
    workflow_enqueued: enqueued,
    trigger: domainChanged ? 'refresh' : 'register',
    was_update: domainChanged,
  });

  const status = await fetchStatus(knex, tenant);
  return { status };
});

export const refreshPortalDomainStatusAction = withAuth(async (user, { tenant }): Promise<PortalDomainStatusResponse> => {
  const { knex } = await createTenantKnex();
  await checkPermission(user, READ_ACTION, knex);
  const current = await getPortalDomain(knex, tenant);

  if (current) {
    await getPortalDomainProvisioner().refresh({ knex, tenant, existing: current });
  }

  const status = await fetchStatus(knex, tenant);

  analytics.capture('portal_domain.refresh', {
    tenant_id: tenant,
    status: status.status,
  });

  return status;
});

const RETRYABLE_FAILURE_STATUSES: PortalDomainStatus[] = ['dns_failed', 'certificate_failed'];

export const retryPortalDomainRegistrationAction = withAuth(async (user, { tenant }): Promise<PortalDomainStatusResponse> => {
  const { knex } = await createTenantKnex();
  await checkPermission(user, UPDATE_ACTION, knex);
  const current = await getPortalDomain(knex, tenant);

  if (!current || !current.domain) {
    throw new Error('No failed custom domain registration to retry.');
  }

  if (!RETRYABLE_FAILURE_STATUSES.includes(current.status)) {
    throw new Error('Retry is only available after a failed registration.');
  }

  await getPortalDomainProvisioner().retry({ knex, tenant, existing: current });

  const status = await fetchStatus(knex, tenant);

  analytics.capture('portal_domain.retry', {
    tenant_id: tenant,
    status: status.status,
    failure_status: current.status,
  });

  return status;
});

export const disablePortalDomainAction = withAuth(async (user, { tenant }): Promise<PortalDomainStatusResponse> => {
  const { knex } = await createTenantKnex();
  await checkPermission(user, UPDATE_ACTION, knex);
  const existing = await getPortalDomain(knex, tenant);

  if (!existing) {
    return fetchStatus(knex, tenant);
  }

  await getPortalDomainProvisioner().disable({ knex, tenant, existing });

  const status = await fetchStatus(knex, tenant);

  analytics.capture('portal_domain.disable', {
    tenant_id: tenant,
    status: status.status,
  });

  return status;
});
