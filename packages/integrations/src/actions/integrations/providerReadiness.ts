'use server';

import { getSecretProviderInstance } from '@alga-psa/core/secrets';

const MICROSOFT_CLIENT_ID_SECRET = 'microsoft_client_id';
const MICROSOFT_CLIENT_SECRET_SECRET = 'microsoft_client_secret';

export interface ProviderReadinessResult {
  ready: boolean;
  clientIdConfigured: boolean;
  clientSecretConfigured: boolean;
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
