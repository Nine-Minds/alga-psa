import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { ENTRA_CIPP_SECRET_KEYS } from '../../secrets';

/**
 * A CIPP API client (CIPP > Integrations > CIPP-API): an Entra app we exchange
 * for short-lived OAuth access tokens. `baseUrl` is the CIPP-API host WITHOUT
 * the trailing `/api` — request paths append `/api/...`, exactly as they do for
 * legacy connections.
 */
export interface EntraCippApiClientCredentials {
  authType: 'api_client';
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  directoryId: string;
}

/** The static CIPP API key CIPP no longer issues; kept for existing connections. */
export interface EntraCippLegacyCredentials {
  authType: 'legacy_api_token';
  baseUrl: string;
  apiToken: string;
}

export type EntraCippCredentials =
  | EntraCippApiClientCredentials
  | EntraCippLegacyCredentials;

export async function saveEntraCippCredentials(
  tenant: string,
  credentials: EntraCippCredentials
): Promise<void> {
  const secretProvider = await getSecretProviderInstance();
  const set = (key: string, value: string) =>
    secretProvider.setTenantSecret(tenant, key, value);
  const remove = (key: string) =>
    secretProvider.deleteTenantSecret(tenant, key).catch(() => undefined);

  // One slot per tenant: saving one shape retires the other's fields, so a
  // reconnect (or a rollback to the previous credential) never leaves a stale
  // secret behind that getEntraCippCredentials could mistake for current.
  if (credentials.authType === 'api_client') {
    await set(ENTRA_CIPP_SECRET_KEYS.baseUrl, credentials.baseUrl);
    await set(ENTRA_CIPP_SECRET_KEYS.clientId, credentials.clientId);
    await set(ENTRA_CIPP_SECRET_KEYS.clientSecret, credentials.clientSecret);
    await set(ENTRA_CIPP_SECRET_KEYS.directoryId, credentials.directoryId);
    await set(ENTRA_CIPP_SECRET_KEYS.authType, 'api_client');
    await remove(ENTRA_CIPP_SECRET_KEYS.apiToken);
    return;
  }

  await set(ENTRA_CIPP_SECRET_KEYS.baseUrl, credentials.baseUrl);
  await set(ENTRA_CIPP_SECRET_KEYS.apiToken, credentials.apiToken);
  await set(ENTRA_CIPP_SECRET_KEYS.authType, 'legacy_api_token');
  await Promise.all([
    remove(ENTRA_CIPP_SECRET_KEYS.clientId),
    remove(ENTRA_CIPP_SECRET_KEYS.clientSecret),
    remove(ENTRA_CIPP_SECRET_KEYS.directoryId),
  ]);
}

export async function getEntraCippCredentials(
  tenant: string
): Promise<EntraCippCredentials | null> {
  const secretProvider = await getSecretProviderInstance();
  const get = (key: string) => secretProvider.getTenantSecret(tenant, key);
  const [baseUrl, apiToken, authType, clientId, clientSecret, directoryId] = await Promise.all([
    get(ENTRA_CIPP_SECRET_KEYS.baseUrl),
    get(ENTRA_CIPP_SECRET_KEYS.apiToken),
    get(ENTRA_CIPP_SECRET_KEYS.authType),
    get(ENTRA_CIPP_SECRET_KEYS.clientId),
    get(ENTRA_CIPP_SECRET_KEYS.clientSecret),
    get(ENTRA_CIPP_SECRET_KEYS.directoryId),
  ]);

  // A missing authType is a row from before API clients: legacy.
  if (authType === 'api_client') {
    if (!baseUrl || !clientId || !clientSecret || !directoryId) {
      return null;
    }
    return { authType: 'api_client', baseUrl, clientId, clientSecret, directoryId };
  }

  if (!baseUrl || !apiToken) {
    return null;
  }

  return { authType: 'legacy_api_token', baseUrl, apiToken };
}

export async function clearEntraCippCredentials(tenant: string): Promise<void> {
  const secretProvider = await getSecretProviderInstance();

  // Every CIPP key, including the API-client ones: disconnect must not leave a
  // client secret behind.
  await Promise.all(
    Object.values(ENTRA_CIPP_SECRET_KEYS).map((key) =>
      secretProvider.deleteTenantSecret(tenant, key).catch(() => undefined)
    )
  );
}
