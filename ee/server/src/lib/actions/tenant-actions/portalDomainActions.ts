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
import { getPortalDomainLastSeen } from '@/lib/portal-domains/portalDomainSeen';
import type { IUser } from 'server/src/interfaces/auth.interfaces';
import { analytics } from '@/lib/analytics/posthog';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

// Grace period before an active appliance domain with no observed traffic is
// flagged as "never seen on its Host" — long enough for DNS/proxy to be wired up.
const NEVER_SEEN_GRACE_MS = 10 * 60 * 1000;

const REQUIRED_RESOURCE = 'settings';
const READ_ACTION = 'read';
const UPDATE_ACTION = 'update';

type PortalDomainActionError = ActionMessageError | ActionPermissionError;
export type PortalDomainStatusActionResult = PortalDomainStatusResponse | PortalDomainActionError;
export type PortalDomainRegistrationActionResult = PortalDomainRegistrationResult | PortalDomainActionError;

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
): Promise<PortalDomainActionError | null> {
  if (action === UPDATE_ACTION && user.user_type === 'client') {
    return permissionError('Client portal users cannot manage custom domains.');
  }

  const allowed = await hasPermission(user, REQUIRED_RESOURCE, action, knex);
  if (!allowed) {
    return permissionError('You do not have permission to manage client portal settings.');
  }

  return null;
}

function validateRequestedDomain(rawDomain: string, canonicalHost: string): string | ActionMessageError {
  if (!rawDomain?.trim()) {
    return actionError('Domain is required.');
  }

  const normalized = normalizeHostname(rawDomain);

  if (normalized.length < 3 || normalized.length > 253) {
    return actionError('Domain must be between 3 and 253 characters.');
  }

  if (!/^[a-z0-9.-]+$/.test(normalized)) {
    return actionError('Domain may only include letters, numbers, hyphens, and dots.');
  }

  if (!normalized.includes('.')) {
    return actionError('Domain must include at least one dot.');
  }

  if (normalized === canonicalHost) {
    return actionError('Please choose a domain other than the canonical host.');
  }

  if (normalized.startsWith('.') || normalized.endsWith('.')) {
    return actionError('Domain cannot start or end with a dot.');
  }

  return normalized;
}

function getNextAuthHostname(): string | null {
  const nextAuthUrl = process.env.NEXTAUTH_URL;
  if (!nextAuthUrl) {
    return null;
  }

  try {
    return new URL(nextAuthUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function validateDirectModeDomain(domain: string): ActionMessageError | null {
  if (resolveDeploymentCapabilities().portalDomain.provisioner !== 'direct') {
    return null;
  }

  const appHost = getNextAuthHostname();
  if (appHost && domain === appHost) {
    return actionError(
      "Choose a domain other than this appliance's primary host. The custom portal domain must be a different hostname that your reverse proxy forwards here."
    );
  }

  return null;
}

async function computeNeverSeenOnHost(record: PortalDomain | null): Promise<boolean> {
  // Appliance ("direct") only, and only once an active domain has had time to be wired up.
  if (resolveDeploymentCapabilities().portalDomain.provisioner !== 'direct') {
    return false;
  }
  if (!record || record.status !== 'active' || !record.domain) {
    return false;
  }
  const activatedAt = record.createdAt ? new Date(record.createdAt).getTime() : Date.now();
  if (Number.isFinite(activatedAt) && Date.now() - activatedAt < NEVER_SEEN_GRACE_MS) {
    return false;
  }
  const lastSeen = await getPortalDomainLastSeen(record.domain);
  return lastSeen === null;
}

async function fetchStatus(knex: Knex, tenant: string): Promise<PortalDomainStatusResponse> {
  const canonicalHost = computeCanonicalHost(tenant);
  const record = await getPortalDomain(knex, tenant);
  const response = createStatusResponse(record, canonicalHost);
  response.neverSeenOnHost = await computeNeverSeenOnHost(record);
  return response;
}

export const getPortalDomainStatusAction = withAuth(async (user, { tenant }): Promise<PortalDomainStatusActionResult> => {
  const { knex } = await createTenantKnex();
  const permissionFailure = await checkPermission(user, READ_ACTION, knex);
  if (permissionFailure) {
    return permissionFailure;
  }

  return fetchStatus(knex, tenant);
});

export const requestPortalDomainRegistrationAction = withAuth(async (
  user,
  { tenant },
  request: PortalDomainRegistrationRequest
): Promise<PortalDomainRegistrationActionResult> => {
  const { knex } = await createTenantKnex();
  const permissionFailure = await checkPermission(user, UPDATE_ACTION, knex);
  if (permissionFailure) {
    return permissionFailure;
  }

  const canonicalHost = computeCanonicalHost(tenant);
  const existing = await getPortalDomain(knex, tenant);
  const normalizedDomain = validateRequestedDomain(request.domain, canonicalHost);
  if (typeof normalizedDomain !== 'string') {
    return normalizedDomain;
  }

  const directModeFailure = validateDirectModeDomain(normalizedDomain);
  if (directModeFailure) {
    return directModeFailure;
  }

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

export const refreshPortalDomainStatusAction = withAuth(async (user, { tenant }): Promise<PortalDomainStatusActionResult> => {
  const { knex } = await createTenantKnex();
  const permissionFailure = await checkPermission(user, READ_ACTION, knex);
  if (permissionFailure) {
    return permissionFailure;
  }

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

export const retryPortalDomainRegistrationAction = withAuth(async (user, { tenant }): Promise<PortalDomainStatusActionResult> => {
  const { knex } = await createTenantKnex();
  const permissionFailure = await checkPermission(user, UPDATE_ACTION, knex);
  if (permissionFailure) {
    return permissionFailure;
  }

  const current = await getPortalDomain(knex, tenant);

  if (!current || !current.domain) {
    return actionError('No failed custom domain registration to retry.');
  }

  if (!RETRYABLE_FAILURE_STATUSES.includes(current.status)) {
    return actionError('Retry is only available after a failed registration.');
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

export const disablePortalDomainAction = withAuth(async (user, { tenant }): Promise<PortalDomainStatusActionResult> => {
  const { knex } = await createTenantKnex();
  const permissionFailure = await checkPermission(user, UPDATE_ACTION, knex);
  if (permissionFailure) {
    return permissionFailure;
  }

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
