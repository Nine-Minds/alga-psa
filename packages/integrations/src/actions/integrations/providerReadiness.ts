'use server';

import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { isSelfHostLicensing } from '@alga-psa/licensing';
import {
  getMicrosoftPlatformCredentialAvailability,
  resolveMicrosoftConsumerProfileConfigReadOnly,
} from '../../lib/microsoftConsumerProfileResolution';

const MICROSOFT_CLIENT_ID_SECRET = 'microsoft_client_id';
const MICROSOFT_CLIENT_SECRET_SECRET = 'microsoft_client_secret';
const GOOGLE_CLIENT_ID_SECRET = 'google_client_id';
const GOOGLE_CLIENT_SECRET_SECRET = 'google_client_secret';

export interface ProviderReadinessResult {
  ready: boolean;
  clientIdConfigured: boolean;
  clientSecretConfigured: boolean;
  tenantIdConfigured?: boolean;
  active?: boolean;
}

export type MicrosoftEmailSetupState = 'not_configured' | 'pending_admin_consent' | 'ready';
export type MicrosoftEmailSetupSource = 'platform' | 'tenant_app' | null;

export interface MicrosoftEmailSetupReadiness {
  state: MicrosoftEmailSetupState;
  source: MicrosoftEmailSetupSource;
  hosted: boolean;
  platformOffered: boolean;
  automatedCreationAvailable: boolean;
  profileId?: string | null;
  message?: string;
}

export interface MicrosoftProfileReadinessInput {
  clientId?: string | null;
  tenantId?: string | null;
  clientSecretRef?: string | null;
  isArchived?: boolean;
}

export async function getMicrosoftProviderReadiness(tenant: string): Promise<ProviderReadinessResult> {
  const secretProvider = await getSecretProviderInstance();
  const [clientId, clientSecret] = await Promise.all([
    secretProvider.getTenantSecret(tenant, MICROSOFT_CLIENT_ID_SECRET),
    secretProvider.getTenantSecret(tenant, MICROSOFT_CLIENT_SECRET_SECRET),
  ]);

  const clientIdConfigured = Boolean((clientId || '').trim());
  const clientSecretConfigured = Boolean((clientSecret || '').trim());

  return {
    ready: clientIdConfigured && clientSecretConfigured,
    clientIdConfigured,
    clientSecretConfigured,
  };
}

export async function getMicrosoftEmailSetupReadiness(
  tenant: string
): Promise<MicrosoftEmailSetupReadiness> {
  const hosted = !(await isSelfHostLicensing());
  // Read-only resolution: this helper feeds settings/status surfaces only
  // (email setup options, consumer setup status, integration status). It must
  // never run the legacy profile/binding migration as a page-load side effect.
  const [resolution, platform, platformResolution] = await Promise.all([
    resolveMicrosoftConsumerProfileConfigReadOnly(
      tenant,
      'email',
      { credentialPreference: 'tenant' }
    ),
    getMicrosoftPlatformCredentialAvailability(),
    hosted
      ? resolveMicrosoftConsumerProfileConfigReadOnly(tenant, 'email', { credentialPreference: 'platform' })
      : Promise.resolve(null),
  ]);

  const source: MicrosoftEmailSetupSource = resolution.credentialSource === 'binding'
    || Boolean(resolution.profileId)
    ? platformResolution?.status === 'ready'
      && Boolean(resolution.clientId)
      && resolution.clientId === platformResolution.clientId
        ? 'platform'
        : 'tenant_app'
    : null;
  const state: MicrosoftEmailSetupState = resolution.status === 'pending_admin_consent'
    ? 'pending_admin_consent'
    : resolution.status === 'ready' && source
      ? 'ready'
      : 'not_configured';

  return {
    state,
    source,
    hosted,
    platformOffered: hosted && platform.ready,
    automatedCreationAvailable: false,
    profileId: resolution.profileId,
    message: resolution.message,
  };
}

export async function getMicrosoftProfileReadiness(
  tenant: string,
  profile: MicrosoftProfileReadinessInput
): Promise<ProviderReadinessResult> {
  const secretProvider = await getSecretProviderInstance();
  const clientSecret = profile.clientSecretRef
    ? await secretProvider.getTenantSecret(tenant, profile.clientSecretRef)
    : null;

  const clientIdConfigured = Boolean((profile.clientId || '').trim());
  const clientSecretConfigured = Boolean((clientSecret || '').trim());
  const tenantIdConfigured = Boolean((profile.tenantId || '').trim());
  const active = !profile.isArchived;

  return {
    ready: clientIdConfigured && clientSecretConfigured && tenantIdConfigured && active,
    clientIdConfigured,
    clientSecretConfigured,
    tenantIdConfigured,
    active,
  };
}

export async function getGoogleProviderReadiness(tenant: string): Promise<ProviderReadinessResult> {
  const secretProvider = await getSecretProviderInstance();
  const [clientId, clientSecret] = await Promise.all([
    secretProvider.getTenantSecret(tenant, GOOGLE_CLIENT_ID_SECRET),
    secretProvider.getTenantSecret(tenant, GOOGLE_CLIENT_SECRET_SECRET),
  ]);

  const clientIdConfigured = Boolean((clientId || '').trim());
  const clientSecretConfigured = Boolean((clientSecret || '').trim());

  return {
    ready: clientIdConfigured && clientSecretConfigured,
    clientIdConfigured,
    clientSecretConfigured,
  };
}
