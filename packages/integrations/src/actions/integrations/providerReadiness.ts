'use server';

import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import {
  getMicrosoftPlatformCredentialAvailability,
  resolveMicrosoftConsumerProfileConfig,
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

export type MicrosoftCredentialCapabilitySource = 'tenant' | 'platform' | 'none';

export interface MicrosoftCredentialCapability {
  ready: boolean;
  source: MicrosoftCredentialCapabilitySource;
  platformReady: boolean;
  tenantProfileSelected: boolean;
  clientIdConfigured: boolean;
  clientSecretConfigured: boolean;
  tenantIdConfigured: boolean;
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

export async function getMicrosoftEmailCredentialCapability(
  tenant: string
): Promise<MicrosoftCredentialCapability> {
  const [resolution, platform] = await Promise.all([
    resolveMicrosoftConsumerProfileConfig(tenant, 'email'),
    getMicrosoftPlatformCredentialAvailability(),
  ]);

  const source: MicrosoftCredentialCapabilitySource = resolution.credentialSource === 'binding'
    || (resolution.profileId && resolution.status !== 'ready')
    ? 'tenant'
    : resolution.credentialSource === 'app'
      ? 'platform'
      : 'none';
  const ready = resolution.status === 'ready';

  return {
    ready,
    source,
    platformReady: platform.ready,
    tenantProfileSelected: source === 'tenant',
    clientIdConfigured: ready ? Boolean(resolution.clientId) : source === 'none' && platform.clientIdConfigured,
    clientSecretConfigured: ready ? Boolean(resolution.clientSecret) : source === 'none' && platform.clientSecretConfigured,
    tenantIdConfigured: ready
      ? Boolean(resolution.microsoftTenantId)
      : source === 'none' && platform.tenantIdConfigured,
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
