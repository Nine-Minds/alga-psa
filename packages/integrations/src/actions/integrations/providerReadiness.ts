'use server';

import { getSecretProviderInstance } from '@alga-psa/core/secrets';

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
