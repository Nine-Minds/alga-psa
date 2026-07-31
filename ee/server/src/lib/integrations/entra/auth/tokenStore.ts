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
  return (await secretProvider.getTenantSecret(tenant, ENTRA_DIRECT_SECRET_KEYS.refreshToken)) ?? null;
}

export async function saveEntraDirectRefreshToken(
  tenant: string,
  refreshToken: string
): Promise<void> {
  const secretProvider = await getSecretProviderInstance();
  await secretProvider.setTenantSecret(
    tenant,
    ENTRA_DIRECT_SECRET_KEYS.refreshToken,
    refreshToken
  );
}

/**
 * The whole stored token set, for callers that have to put it back. Saving a
 * new set is destructive — there is one slot per tenant — so anything that
 * overwrites it before a step that can still fail needs the predecessor in
 * hand to restore.
 */
export async function getEntraDirectTokenSet(tenant: string): Promise<EntraDirectTokenSet | null> {
  const secretProvider = await getSecretProviderInstance();
  const [accessToken, refreshToken, expiresAt, scope] = await Promise.all([
    secretProvider.getTenantSecret(tenant, ENTRA_DIRECT_SECRET_KEYS.accessToken),
    secretProvider.getTenantSecret(tenant, ENTRA_DIRECT_SECRET_KEYS.refreshToken),
    secretProvider.getTenantSecret(tenant, ENTRA_DIRECT_SECRET_KEYS.tokenExpiresAt),
    secretProvider.getTenantSecret(tenant, ENTRA_DIRECT_SECRET_KEYS.tokenScope),
  ]);

  if (!accessToken || !refreshToken || !expiresAt) {
    return null;
  }

  return { accessToken, refreshToken, expiresAt, scope: scope || null };
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
