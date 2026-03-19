'use server';

import { getSecretProviderInstance } from '@alga-psa/core/secrets';

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
