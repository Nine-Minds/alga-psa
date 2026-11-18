'use server';

import type { Knex } from 'knex';

import { createTenantKnex } from '@/lib/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import {
  computeCanonicalHost,
  getPortalDomain,
  getPortalDomainByHostname,
  updatePortalDomain,
  isPortalDomainSurface,
  DEFAULT_PORTAL_DOMAIN_SURFACE,
  type PortalDomainStatus,
  normalizeHostname,
  type PortalDomain,
} from '@/models/PortalDomainModel';
import type {
  PortalDomainStatusResponse,
  PortalDomainRegistrationRequest,
  PortalDomainRegistrationResult,
} from '@alga-psa/tenancy/actions/tenant-actions/portalDomain.types';
import {
  confirmAllRequired,
  describeMissingRedirectUris,
  evaluateSsoRedirectUriGate,
  readSsoRedirectUriState,
  withSsoRedirectUriState,
} from '@/lib/portal-domains/ssoRedirectUris';
import { isEnterpriseEdition } from '@/lib/features';
import { resolvePortalDomainProvisioning } from '@/lib/portal-domains/provisioner';
import { getPortalDomainLastSeen } from '@/lib/portal-domains/portalDomainSeen';
import type { IUser } from '@/interfaces/auth.interfaces';
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

function buildRedirectUriStatus(
  record: PortalDomain | null,
  mode: string
): Pick<PortalDomainStatusResponse, 'ssoRedirectUris'> {
  const state = readSsoRedirectUriState(record?.verificationDetails);
  if (!record || !state) {
    return {};
  }
  return {
    ssoRedirectUris: {
      required: state.required,
      confirmed: state.confirmed,
      missing: evaluateSsoRedirectUriGate(record.surface, record.verificationDetails).missing,
      source: state.source ?? null,
      // Only the appliance owner controls the IdP + proxy; hosted needs platform ops.
      canSelfConfirm: mode === 'direct',
    },
  };
}

function createStatusResponse(record: PortalDomain | null, canonicalHost: string): PortalDomainStatusResponse {
  const statusMessage = record?.statusMessage ?? 'No custom domain registered yet.';
  const { mode } = resolvePortalDomainProvisioning();

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
    // Every build has a driver (`direct` is the universal fallback), so the
    // server-side status is always editable; the read-only `false` only comes
    // from the tenancy package's stub used by the client portal.
    isEditable: true,
    edition: isEnterpriseEdition() ? 'ee' : 'ce',
    mode,
    surface: record?.surface ?? DEFAULT_PORTAL_DOMAIN_SURFACE,
    ...buildRedirectUriStatus(record, mode),
  };
}

async function checkPermission(
  user: IUser,
  action: typeof READ_ACTION | typeof UPDATE_ACTION,
  knex: Knex
): Promise<PortalDomainActionError | null> {
  if (action === UPDATE_ACTION && user.user_type === 'client') {
    return permissionError('Client portal users cannot manage custom domains.', 'msp/settings:errors.clientPortalDomain.portalUsersNotAllowed');
  }

  const allowed = await hasPermission(user, REQUIRED_RESOURCE, action, knex);
  if (!allowed) {
    return permissionError('You do not have permission to manage client portal settings.', 'msp/settings:errors.clientPortalDomain.noPermission');
  }

  return null;
}

function validateRequestedDomain(rawDomain: string, canonicalHost: string): string | ActionMessageError {
  if (!rawDomain?.trim()) {
    return actionError('Domain is required.', 'msp/settings:errors.clientPortalDomain.required');
  }

  const normalized = normalizeHostname(rawDomain);

  if (normalized.length < 3 || normalized.length > 253) {
    return actionError('Domain must be between 3 and 253 characters.', 'msp/settings:errors.clientPortalDomain.length');
  }

  if (!/^[a-z0-9.-]+$/.test(normalized)) {
    return actionError('Domain may only include letters, numbers, hyphens, and dots.', 'msp/settings:errors.clientPortalDomain.charset');
  }

  if (!normalized.includes('.')) {
    return actionError('Domain must include at least one dot.', 'msp/settings:errors.clientPortalDomain.needsDot');
  }

  if (normalized === canonicalHost) {
    return actionError('Please choose a domain other than the canonical host.', 'msp/settings:errors.clientPortalDomain.notCanonicalHost');
  }

  if (normalized.startsWith('.') || normalized.endsWith('.')) {
    return actionError('Domain cannot start or end with a dot.', 'msp/settings:errors.clientPortalDomain.noLeadingTrailingDot');
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
  if (resolvePortalDomainProvisioning().mode !== 'direct') {
    return null;
  }

  const appHost = getNextAuthHostname();
  if (appHost && domain === appHost) {
    return actionError("Choose a domain other than this server's primary host. The custom portal domain must be a different hostname that your reverse proxy forwards here.", 'msp/settings:errors.clientPortalDomain.notApplianceHost');
  }

  return null;
}

async function computeNeverSeenOnHost(record: PortalDomain | null): Promise<boolean> {
  // Direct mode only, and only once an active domain has had time to be wired up.
  if (resolvePortalDomainProvisioning().mode !== 'direct') {
    return false;
  }
  if (!record || record.status !== 'active' || !record.domain) {
    return false;
  }
  const activatedAt = new Date(record.lastCheckedAt ?? record.createdAt ?? Date.now()).getTime();
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

  const { provisioner } = resolvePortalDomainProvisioning();
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

  const surface = request.surface === undefined ? (existing?.surface ?? DEFAULT_PORTAL_DOMAIN_SURFACE) : request.surface;
  if (!isPortalDomainSurface(surface)) {
    return actionError('Choose where the custom domain is served: client portal, MSP app, or both.', 'msp/settings:errors.clientPortalDomain.invalidSurface');
  }

  // D7: one host maps to exactly one tenant AND one surface row. The global unique index on
  // lower(domain) enforces this in the database; these checks turn it into a clear refusal.
  const claimedBy = await getPortalDomainByHostname(knex, normalizedDomain);
  if (claimedBy && claimedBy.tenant !== tenant) {
    return actionError('This domain is already in use. Choose a different domain.', 'msp/settings:errors.clientPortalDomain.alreadyInUse');
  }
  if (claimedBy && claimedBy.id !== existing?.id) {
    // Same tenant, different surface row. Serving both apps from one host is `surface=both`
    // on a single row (path routing), never a second row for the same host.
    return actionError(
      'This domain is already used by another of your custom domains. To serve the client portal and the MSP app from one domain, choose "Both".',
      'msp/settings:errors.clientPortalDomain.usedByOtherSurface'
    );
  }

  const domainChanged = existing ? existing.domain !== normalizedDomain : false;

  const { enqueued } = await provisioner.register({
    knex,
    tenant,
    canonicalHost,
    domain: normalizedDomain,
    existing,
    domainChanged,
    surface,
  });

  analytics.capture('portal_domain.registration_enqueued', {
    tenant_id: tenant,
    domain: normalizedDomain,
    workflow_enqueued: enqueued,
    surface,
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
    await resolvePortalDomainProvisioning().provisioner.refresh({ knex, tenant, existing: current });
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
    return actionError('No failed custom domain registration to retry.', 'msp/settings:errors.clientPortalDomain.nothingToRetry');
  }

  if (!RETRYABLE_FAILURE_STATUSES.includes(current.status)) {
    return actionError('Retry is only available after a failed registration.', 'msp/settings:errors.clientPortalDomain.retryOnlyAfterFailure');
  }

  await resolvePortalDomainProvisioning().provisioner.retry({ knex, tenant, existing: current });

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

  await resolvePortalDomainProvisioning().provisioner.disable({ knex, tenant, existing });

  const status = await fetchStatus(knex, tenant);

  analytics.capture('portal_domain.disable', {
    tenant_id: tenant,
    status: status.status,
  });

  return status;
});


/**
 * Attest that the SSO redirect URIs for the domain are registered with the identity
 * provider(s). Self-service only where the tenant owns the IdP and proxy (appliance /
 * direct mode); hosted deployments need platform operators to register the URIs.
 */
export const confirmPortalDomainRedirectUrisAction = withAuth(async (user, { tenant }): Promise<PortalDomainStatusActionResult> => {
  const { knex } = await createTenantKnex();
  const permissionFailure = await checkPermission(user, UPDATE_ACTION, knex);
  if (permissionFailure) {
    return permissionFailure;
  }

  const { provisioner, mode } = resolvePortalDomainProvisioning();
  if (mode !== 'direct') {
    return permissionError('Redirect URIs for hosted domains are registered by platform support.', 'msp/settings:errors.clientPortalDomain.redirectUrisHosted');
  }

  const current = await getPortalDomain(knex, tenant);
  const state = readSsoRedirectUriState(current?.verificationDetails);
  if (!current || current.status !== 'pending_redirect_uri' || !state) {
    return actionError('No pending SSO redirect URI confirmation for this domain.', 'msp/settings:errors.clientPortalDomain.nothingToConfirm');
  }

  const updated = await updatePortalDomain(knex, tenant, { id: current.id }, {
    verificationDetails: withSsoRedirectUriState(current.verificationDetails, confirmAllRequired(state)),
    statusMessage: describeMissingRedirectUris([]),
  });
  await provisioner.refresh({ knex, tenant, existing: updated ?? current });

  const status = await fetchStatus(knex, tenant);
  analytics.capture('portal_domain.redirect_uris_confirmed', { tenant_id: tenant, status: status.status });
  return status;
});
