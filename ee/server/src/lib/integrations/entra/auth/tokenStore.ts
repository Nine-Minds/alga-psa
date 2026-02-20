import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { ENTRA_DIRECT_SECRET_KEYS } from '../secrets';

export interface EntraDirectTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scope: string | null;
}

export async function saveEntraDirectTokenSet(
  tenant: string,
  tokens: EntraDirectTokenSet
): Promise<void> {
  const secretProvider = await getSecretProviderInstance();

  await secretProvider.setTenantSecret(
    tenant,
    ENTRA_DIRECT_SECRET_KEYS.accessToken,
    tokens.accessToken
  );
  await secretProvider.setTenantSecret(
    tenant,
    ENTRA_DIRECT_SECRET_KEYS.refreshToken,
    tokens.refreshToken
  );
  await secretProvider.setTenantSecret(
    tenant,
    ENTRA_DIRECT_SECRET_KEYS.tokenExpiresAt,
    tokens.expiresAt
  );
  await secretProvider.setTenantSecret(
    tenant,
    ENTRA_DIRECT_SECRET_KEYS.tokenScope,
    tokens.scope || ''
  );
}

export async function getEntraDirectRefreshToken(tenant: string): Promise<string | null> {
  const secretProvider = await getSecretProviderInstance();
  return secretProvider.getTenantSecret(tenant, ENTRA_DIRECT_SECRET_KEYS.refreshToken);
}

export async function clearEntraDirectTokenSet(tenant: string): Promise<void> {
  const secretProvider = await getSecretProviderInstance();

  await Promise.all([
    secretProvider.deleteTenantSecret(tenant, ENTRA_DIRECT_SECRET_KEYS.accessToken).catch(() => undefined),
    secretProvider.deleteTenantSecret(tenant, ENTRA_DIRECT_SECRET_KEYS.refreshToken).catch(() => undefined),
    secretProvider.deleteTenantSecret(tenant, ENTRA_DIRECT_SECRET_KEYS.tokenExpiresAt).catch(() => undefined),
    secretProvider.deleteTenantSecret(tenant, ENTRA_DIRECT_SECRET_KEYS.partnerTenantId).catch(() => undefined),
    secretProvider.deleteTenantSecret(tenant, ENTRA_DIRECT_SECRET_KEYS.tokenScope).catch(() => undefined),
  ]);
}
