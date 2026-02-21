import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { ENTRA_CIPP_SECRET_KEYS } from '../../secrets';

export interface EntraCippCredentials {
  baseUrl: string;
  apiToken: string;
}

export async function saveEntraCippCredentials(
  tenant: string,
  credentials: EntraCippCredentials
): Promise<void> {
  const secretProvider = await getSecretProviderInstance();

  await secretProvider.setTenantSecret(
    tenant,
    ENTRA_CIPP_SECRET_KEYS.baseUrl,
    credentials.baseUrl
  );
  await secretProvider.setTenantSecret(
    tenant,
    ENTRA_CIPP_SECRET_KEYS.apiToken,
    credentials.apiToken
  );
}

export async function getEntraCippCredentials(
  tenant: string
): Promise<EntraCippCredentials | null> {
  const secretProvider = await getSecretProviderInstance();
  const [baseUrl, apiToken] = await Promise.all([
    secretProvider.getTenantSecret(tenant, ENTRA_CIPP_SECRET_KEYS.baseUrl),
    secretProvider.getTenantSecret(tenant, ENTRA_CIPP_SECRET_KEYS.apiToken),
  ]);

  if (!baseUrl || !apiToken) {
    return null;
  }

  return { baseUrl, apiToken };
}

export async function clearEntraCippCredentials(tenant: string): Promise<void> {
  const secretProvider = await getSecretProviderInstance();

  await Promise.all([
    secretProvider.deleteTenantSecret(tenant, ENTRA_CIPP_SECRET_KEYS.baseUrl).catch(() => undefined),
    secretProvider.deleteTenantSecret(tenant, ENTRA_CIPP_SECRET_KEYS.apiToken).catch(() => undefined),
  ]);
}
