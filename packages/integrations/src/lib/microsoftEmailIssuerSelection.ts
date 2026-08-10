/**
 * Explicit Microsoft inbound-email issuer selection.
 *
 * When an admin creates or reconnects a Microsoft inbound-email provider they
 * must choose which Microsoft OAuth application authorizes the mailbox. That
 * choice travels through OAuth initiation, signed state, and callback, and is
 * persisted on `microsoft_email_provider_config` as provider-authoritative
 * issuer metadata (`client_id` + optional `microsoft_profile_id`).
 *
 * This module owns the choice DTO, the eligibility listing shown in the UI, the
 * server-side validation of a submitted choice, and the conservative legacy
 * backfill. It never touches Teams profiles, credentials, or bindings.
 */

import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import {
  hasMicrosoftProfileCapability,
  normalizeMicrosoftProfileCapabilities,
  type MicrosoftProfileConsumer,
} from '../actions/integrations/microsoftShared';
import { resolveMicrosoftConsumerProfileConfig } from './microsoftConsumerProfileResolution';

export type MicrosoftEmailIssuerKind = 'managed' | 'profile';

/**
 * The explicit issuer choice submitted by the admin. Carries the client
 * identity so the server never has to infer the intended app from bindings.
 */
export interface MicrosoftEmailIssuerChoice {
  kind: MicrosoftEmailIssuerKind;
  /** Present and required when `kind === 'profile'`. */
  profileId?: string;
  /** The explicit client ID of the chosen application. */
  clientId: string;
}

/** A selectable option surfaced by `getMicrosoftEmailIssuerOptions`. */
export interface MicrosoftEmailIssuerOption {
  kind: MicrosoftEmailIssuerKind;
  label: string;
  clientId: string;
  profileId?: string;
  tenantId?: string;
  recommended?: boolean;
}

export interface MicrosoftEmailIssuerOptions {
  /** The hosted/managed application, when the platform is ready. */
  managed?: MicrosoftEmailIssuerOption;
  /** Eligible tenant-owned profiles (active, Email-capable, ready, consent-ready). */
  profiles: MicrosoftEmailIssuerOption[];
  /**
   * The recommended default choice for a new provider: the managed app when
   * offered, otherwise the tenant Email binding's profile when eligible.
   */
  recommended: MicrosoftEmailIssuerChoice | null;
}

/** Resolved, validated credentials for a chosen issuer. */
export interface MicrosoftEmailIssuerResolution {
  choice: MicrosoftEmailIssuerChoice;
  issuerKind: MicrosoftEmailIssuerKind;
  clientId: string;
  clientSecret: string;
  clientSecretRef?: string;
  microsoftTenantId: string;
  profileId?: string;
}

/** Stable, machine-readable error codes for guarded selection failures. */
export const MICROSOFT_EMAIL_ISSUER_ERRORS = {
  INVALID_CHOICE: 'ms_email_invalid_choice',
  PROFILE_NOT_FOUND: 'ms_email_profile_not_found',
  CROSS_TENANT_PROFILE: 'ms_email_cross_tenant_profile',
  INACTIVE_PROFILE: 'ms_email_inactive_profile',
  MISSING_EMAIL_CAPABILITY: 'ms_email_missing_email_capability',
  ISSUER_NOT_READY: 'ms_email_issuer_not_ready',
  CONSENT_NOT_READY: 'ms_email_consent_not_ready',
  CLIENT_MISMATCH_RECONNECT_REQUIRED: 'ms_email_client_mismatch_reconnect_required',
  INVALID_STATE: 'ms_email_invalid_state',
  EXPIRED_STATE: 'ms_email_expired_state',
  REPLAYED_STATE: 'ms_email_replayed_state',
  CALLBACK_PERSISTENCE_FAILED: 'ms_email_callback_persistence_failed',
  ISSUER_REQUIRED: 'ms_email_issuer_required',
  STATE_USER_MISMATCH: 'ms_email_state_user_mismatch',
  STATE_PURPOSE_MISMATCH: 'ms_email_state_purpose_mismatch',
  PROVIDER_NOT_FOUND: 'ms_email_provider_not_found',
  PROVIDER_TENANT_MISMATCH: 'ms_email_provider_tenant_mismatch',
  PROVIDER_TYPE_NOT_SUPPORTED: 'ms_email_provider_type_not_supported',
} as const;

export type MicrosoftEmailIssuerErrorCode =
  (typeof MICROSOFT_EMAIL_ISSUER_ERRORS)[keyof typeof MICROSOFT_EMAIL_ISSUER_ERRORS];

/** Error thrown for a guarded selection/eligibility failure. Carries a stable code. */
export class MicrosoftEmailIssuerError extends Error {
  readonly code: MicrosoftEmailIssuerErrorCode;

  constructor(code: MicrosoftEmailIssuerErrorCode, message: string) {
    super(message);
    this.name = 'MicrosoftEmailIssuerError';
    this.code = code;
  }
}

interface MicrosoftProfileRow {
  tenant: string;
  profile_id: string;
  display_name: string;
  client_id: string;
  tenant_id: string;
  client_secret_ref: string;
  email_admin_consent_required?: boolean;
  email_admin_consent_granted_at?: string | Date | null;
  capabilities: MicrosoftProfileConsumer[] | string | null;
  is_default: boolean;
  is_archived: boolean;
}

function normalizeTenantId(value?: string | null): string {
  return (value || '').trim() || 'common';
}

function normalizeClientId(value?: string | null): string {
  return (value || '').trim();
}

export function isSameMicrosoftClientId(left: string | null | undefined, right: string | null | undefined): boolean {
  return normalizeClientId(left).toLowerCase() === normalizeClientId(right).toLowerCase();
}

function profileHasEmailCapability(profile: Pick<MicrosoftProfileRow, 'capabilities'>): boolean {
  return hasMicrosoftProfileCapability(normalizeMicrosoftProfileCapabilities(profile.capabilities), 'email');
}

function isConsentReady(profile: Pick<MicrosoftProfileRow, 'email_admin_consent_required' | 'email_admin_consent_granted_at'>): boolean {
  return !profile.email_admin_consent_required || Boolean(profile.email_admin_consent_granted_at);
}

function isEligibleProfile(profile: MicrosoftProfileRow): boolean {
  return (
    !profile.is_archived &&
    profileHasEmailCapability(profile) &&
    Boolean(normalizeClientId(profile.client_id)) &&
    Boolean((profile.tenant_id || '').trim()) &&
    isConsentReady(profile)
  );
}

/**
 * An eligible profile must also prove its credential secret is actually
 * resolvable — not merely claim readiness via a `client_secret_ref`. A profile
 * whose secret cannot be resolved must never surface as a selectable issuer or
 * as a backfill candidate.
 */
async function isEligibleProfileWithResolvableSecret(
  tenant: string,
  profile: MicrosoftProfileRow
): Promise<boolean> {
  if (!isEligibleProfile(profile)) return false;
  const secretProvider = await getSecretProviderInstance();
  const clientSecret = await secretProvider.getTenantSecret(tenant, profile.client_secret_ref);
  return Boolean(clientSecret && clientSecret.trim());
}

async function getTenantProfiles(db: any, tenant: string): Promise<MicrosoftProfileRow[]> {
  const rows = (await tenantDb(db, tenant)
    .table('microsoft_profiles')
    .select('*')) as MicrosoftProfileRow[];
  return rows;
}

async function getProfileRow(db: any, tenant: string, profileId: string): Promise<MicrosoftProfileRow | undefined> {
  const row = await tenantDb(db, tenant)
    .table('microsoft_profiles')
    .where({ profile_id: profileId })
    .first() as MicrosoftProfileRow | undefined;
  return row;
}

/**
 * The tenant-wide Email binding — the create-flow default and a conservative
 * legacy hint. It is never treated as authoritative for an existing provider.
 */
async function getBoundEmailProfile(db: any, tenant: string): Promise<MicrosoftProfileRow | undefined> {
  const binding = await tenantDb(db, tenant)
    .table('microsoft_profile_consumer_bindings')
    .where({ consumer_type: 'email' })
    .first();
  if (!binding?.profile_id) return undefined;
  return getProfileRow(db, tenant, binding.profile_id);
}

async function resolveManagedIssuer(tenant: string): Promise<MicrosoftEmailIssuerResolution | null> {
  const resolution = await resolveMicrosoftConsumerProfileConfig(tenant, 'email', {
    credentialPreference: 'platform',
  });
  if (resolution.status !== 'ready' || !resolution.clientId || !resolution.clientSecret) {
    return null;
  }
  return {
    choice: { kind: 'managed', clientId: resolution.clientId },
    issuerKind: 'managed',
    clientId: resolution.clientId,
    clientSecret: resolution.clientSecret,
    microsoftTenantId: resolution.microsoftTenantId || 'common',
  };
}

async function resolveProfileIssuer(tenant: string, choice: MicrosoftEmailIssuerChoice): Promise<MicrosoftEmailIssuerResolution> {
  if (!choice.profileId) {
    throw new MicrosoftEmailIssuerError(
      MICROSOFT_EMAIL_ISSUER_ERRORS.INVALID_CHOICE,
      'Select a Microsoft application to authorize this mailbox'
    );
  }

  const db = await getAdminConnection();
  const profile = await getProfileRow(db, tenant, choice.profileId);

  // Tenant-scoped lookup: a missing row is either cross-tenant or unknown.
  if (!profile) {
    throw new MicrosoftEmailIssuerError(
      MICROSOFT_EMAIL_ISSUER_ERRORS.PROFILE_NOT_FOUND,
      'The selected Microsoft application was not found in this workspace'
    );
  }
  if (profile.tenant !== tenant) {
    throw new MicrosoftEmailIssuerError(
      MICROSOFT_EMAIL_ISSUER_ERRORS.CROSS_TENANT_PROFILE,
      'The selected Microsoft application belongs to another workspace'
    );
  }
  if (profile.is_archived) {
    throw new MicrosoftEmailIssuerError(
      MICROSOFT_EMAIL_ISSUER_ERRORS.INACTIVE_PROFILE,
      'The selected Microsoft application is archived and cannot authorize mailboxes'
    );
  }
  if (!profileHasEmailCapability(profile)) {
    throw new MicrosoftEmailIssuerError(
      MICROSOFT_EMAIL_ISSUER_ERRORS.MISSING_EMAIL_CAPABILITY,
      'The selected Microsoft application is not enabled for Outlook email'
    );
  }
  if (!isConsentReady(profile)) {
    throw new MicrosoftEmailIssuerError(
      MICROSOFT_EMAIL_ISSUER_ERRORS.CONSENT_NOT_READY,
      'A Microsoft 365 administrator must approve the selected application before mailboxes can use it'
    );
  }

  const secretProvider = await getSecretProviderInstance();
  const clientSecret = (await secretProvider.getTenantSecret(tenant, profile.client_secret_ref)) || '';
  const clientId = normalizeClientId(profile.client_id);

  if (!clientId || !clientSecret || !(profile.tenant_id || '').trim()) {
    throw new MicrosoftEmailIssuerError(
      MICROSOFT_EMAIL_ISSUER_ERRORS.ISSUER_NOT_READY,
      'The selected Microsoft application is missing required setup values'
    );
  }

  return {
    choice: { kind: 'profile', profileId: profile.profile_id, clientId },
    issuerKind: 'profile',
    clientId,
    clientSecret,
    clientSecretRef: profile.client_secret_ref,
    microsoftTenantId: normalizeTenantId(profile.tenant_id),
    profileId: profile.profile_id,
  };
}

/**
 * Validate a submitted issuer choice and resolve its credentials. This is the
 * mandatory server-side gate used by OAuth initiation and by the callback
 * (which never trusts the client's claim alone). Throws `MicrosoftEmailIssuerError`
 * with a stable code for every guarded failure mode.
 */
export async function resolveMicrosoftEmailIssuerChoice(
  tenant: string,
  choice: MicrosoftEmailIssuerChoice | null | undefined
): Promise<MicrosoftEmailIssuerResolution> {
  if (!choice || typeof choice !== 'object') {
    throw new MicrosoftEmailIssuerError(
      MICROSOFT_EMAIL_ISSUER_ERRORS.INVALID_CHOICE,
      'Choose which Microsoft application authorizes this mailbox'
    );
  }

  const clientId = normalizeClientId(choice.clientId);
  if (!clientId) {
    throw new MicrosoftEmailIssuerError(
      MICROSOFT_EMAIL_ISSUER_ERRORS.INVALID_CHOICE,
      'The selected Microsoft application is missing its client ID'
    );
  }

  if (choice.kind === 'managed') {
    const resolution = await resolveManagedIssuer(tenant);
    if (!resolution) {
      throw new MicrosoftEmailIssuerError(
        MICROSOFT_EMAIL_ISSUER_ERRORS.ISSUER_NOT_READY,
        'The AlgaPSA-managed Microsoft application is not ready for mailbox authorization'
      );
    }
    if (!isSameMicrosoftClientId(resolution.clientId, clientId)) {
      throw new MicrosoftEmailIssuerError(
        MICROSOFT_EMAIL_ISSUER_ERRORS.INVALID_CHOICE,
        'The managed application choice does not match the configured client ID'
      );
    }
    return resolution;
  }

  if (choice.kind !== 'profile') {
    throw new MicrosoftEmailIssuerError(
      MICROSOFT_EMAIL_ISSUER_ERRORS.INVALID_CHOICE,
      'Unknown Microsoft application selection'
    );
  }

  const resolution = await resolveProfileIssuer(tenant, choice);
  if (!isSameMicrosoftClientId(resolution.clientId, clientId)) {
    throw new MicrosoftEmailIssuerError(
      MICROSOFT_EMAIL_ISSUER_ERRORS.INVALID_CHOICE,
      'The selected application does not match its client ID'
    );
  }
  return resolution;
}

/**
 * List the eligible issuers presented to the admin. Hosted deployments
 * recommend the managed application; eligible tenant profiles follow. A
 * Teams-only app is never listed.
 */
export async function listEligibleMicrosoftEmailIssuers(
  tenant: string
): Promise<MicrosoftEmailIssuerOptions> {
  const db = await getAdminConnection();
  const [managed, profiles, boundProfile] = await Promise.all([
    resolveManagedIssuer(tenant),
    getTenantProfiles(db, tenant),
    getBoundEmailProfile(db, tenant),
  ]);

  const eligibleProfiles = (await Promise.all(
    profiles.map(async (profile) => ({
      profile,
      eligible: await isEligibleProfileWithResolvableSecret(tenant, profile),
    }))
  ))
    .filter((entry) => entry.eligible)
    .map((entry) => entry.profile)
    .sort((left, right) => {
      if (left.is_default !== right.is_default) return left.is_default ? -1 : 1;
      return left.display_name.localeCompare(right.display_name);
    });

  const profileOptions: MicrosoftEmailIssuerOption[] = eligibleProfiles.map((profile) => ({
    kind: 'profile',
    label: profile.display_name,
    clientId: profile.client_id,
    profileId: profile.profile_id,
    tenantId: normalizeTenantId(profile.tenant_id),
  }));

  const managedOption: MicrosoftEmailIssuerOption | undefined = managed
    ? {
        kind: 'managed',
        label: 'AlgaPSA (managed Microsoft app)',
        clientId: managed.clientId,
        recommended: true,
      }
    : undefined;

  // The create-flow default: managed when offered, else the tenant Email
  // binding's profile when it is eligible and its secret is resolvable.
  let recommended: MicrosoftEmailIssuerChoice | null = null;
  if (managedOption) {
    recommended = { kind: 'managed', clientId: managedOption.clientId };
  } else if (boundProfile && await isEligibleProfileWithResolvableSecret(tenant, boundProfile)) {
    recommended = {
      kind: 'profile',
      profileId: boundProfile.profile_id,
      clientId: boundProfile.client_id,
    };
  }

  return {
    managed: managedOption,
    profiles: profileOptions,
    recommended,
  };
}

/** Describe a persisted provider issuer for display ("current app"). */
export function describePersistedMicrosoftEmailIssuer(config: {
  client_id?: string | null;
  microsoft_profile_id?: string | null;
}): { kind: 'managed' | 'profile' | 'legacy' | 'none'; clientId?: string; profileId?: string } {
  const clientId = normalizeClientId(config.client_id);
  const profileId = normalizeClientId(config.microsoft_profile_id);
  if (profileId && clientId) {
    return { kind: 'profile', clientId, profileId };
  }
  if (clientId) {
    // Whether it maps to the managed app is decided by the caller against the
    // option list; without a profile reference it is a legacy row.
    return { kind: 'legacy', clientId };
  }
  return { kind: 'none' };
}

/**
 * Conservative legacy backfill. Populates `microsoft_profile_id` (and the
 * profile's `client_secret_ref`) only when a legacy provider row's persisted
 * `client_id` has exactly one eligible same-client profile match. Ambiguous,
 * missing, cross-tenant, inactive, or non-Email-capable matches stay legacy
 * rows with `client_id` authoritative. The tenant Email binding may narrow a
 * same-client candidate but never overrides a different persisted client ID.
 * Teams rows are never touched.
 */
export async function backfillMicrosoftEmailProviderIssuerMetadata(tenant: string): Promise<{
  backfilled: number;
  ambiguous: number;
  unchanged: number;
}> {
  const db = await getAdminConnection();

  const profiles = await getTenantProfiles(db, tenant);
  const eligibleByClientId = new Map<string, MicrosoftProfileRow[]>();
  for (const profile of profiles) {
    if (!(await isEligibleProfileWithResolvableSecret(tenant, profile))) continue;
    const key = normalizeClientId(profile.client_id).toLowerCase();
    if (!key) continue;
    const bucket = eligibleByClientId.get(key) || [];
    bucket.push(profile);
    eligibleByClientId.set(key, bucket);
  }

  const providers = (await tenantDb(db, tenant)
    .table('email_providers')
    .where({ provider_type: 'microsoft' })
    .select('id')) as Array<{ id: string }>;

  let backfilled = 0;
  let ambiguous = 0;
  let unchanged = 0;

  for (const provider of providers) {
    const config = await tenantDb(db, tenant)
      .table('microsoft_email_provider_config')
      .where({ email_provider_id: provider.id })
      .first() as (Partial<MicrosoftEmailProviderConfigRow> & { email_provider_id: string }) | undefined;

    if (!config) continue;

    const persistedClientId = normalizeClientId(config.client_id);
    const persistedProfileId = normalizeClientId(config.microsoft_profile_id);
    // Managed-issued and already-pinned rows are not legacy candidates.
    if (!persistedClientId || Boolean(persistedProfileId)) {
      unchanged += 1;
      continue;
    }

    const matches = eligibleByClientId.get(persistedClientId.toLowerCase()) || [];
    if (matches.length !== 1) {
      if (matches.length > 1) ambiguous += 1;
      else unchanged += 1;
      continue;
    }

    const match = matches[0];
    await tenantDb(db, tenant)
      .table('microsoft_email_provider_config')
      .where({ email_provider_id: provider.id })
      .update({
        microsoft_profile_id: match.profile_id,
        client_secret_ref: match.client_secret_ref,
        tenant_id: normalizeTenantId(match.tenant_id),
        updated_at: db.fn.now(),
      });
    backfilled += 1;
  }

  return { backfilled, ambiguous, unchanged };
}

interface MicrosoftEmailProviderConfigRow {
  client_id?: string | null;
  microsoft_profile_id?: string | null;
}
