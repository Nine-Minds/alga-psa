import axios from 'axios';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { resolveMicrosoftCredentialsForTenant } from './microsoftCredentialResolver';
import { ENTRA_DIRECT_SECRET_KEYS } from '../secrets';

export interface RefreshDirectTokenResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scope: string | null;
}

export async function refreshEntraDirectToken(
  tenant: string
): Promise<RefreshDirectTokenResult> {
  const secretProvider = await getSecretProviderInstance();
  const credentials = await resolveMicrosoftCredentialsForTenant(tenant);

  if (!credentials) {
    throw new Error('Microsoft credentials are not configured for direct Entra token refresh.');
  }

  const refreshToken = await secretProvider.getTenantSecret(
    tenant,
    ENTRA_DIRECT_SECRET_KEYS.refreshToken
  );

  if (!refreshToken) {
    throw new Error('No direct Entra refresh token is stored for this tenant.');
  }

  const tokenParams = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: 'https://graph.microsoft.com/User.Read offline_access',
  });

  const response = await axios.post(
    'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    tokenParams.toString(),
    {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    }
  );

  const accessToken = response.data?.access_token as string | undefined;
  const newRefreshToken =
    (response.data?.refresh_token as string | undefined) || refreshToken;
  const expiresIn = response.data?.expires_in as number | undefined;
  const scope = (response.data?.scope as string | undefined) || null;

  if (!accessToken || !expiresIn) {
    throw new Error('Direct Entra token refresh response was missing required fields.');
  }

  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  await secretProvider.setTenantSecret(
    tenant,
    ENTRA_DIRECT_SECRET_KEYS.accessToken,
    accessToken
  );
  await secretProvider.setTenantSecret(
    tenant,
    ENTRA_DIRECT_SECRET_KEYS.refreshToken,
    newRefreshToken
  );
  await secretProvider.setTenantSecret(
    tenant,
    ENTRA_DIRECT_SECRET_KEYS.tokenExpiresAt,
    expiresAt
  );
  await secretProvider.setTenantSecret(
    tenant,
    ENTRA_DIRECT_SECRET_KEYS.tokenScope,
    scope || ''
  );

  return {
    accessToken,
    refreshToken: newRefreshToken,
    expiresAt,
    scope,
  };
}
