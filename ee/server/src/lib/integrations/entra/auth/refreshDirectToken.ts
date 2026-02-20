import axios from 'axios';
import { resolveMicrosoftCredentialsForTenant } from './microsoftCredentialResolver';
import { getEntraDirectRefreshToken, saveEntraDirectTokenSet } from './tokenStore';

export interface RefreshDirectTokenResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scope: string | null;
}

export async function refreshEntraDirectToken(
  tenant: string
): Promise<RefreshDirectTokenResult> {
  const credentials = await resolveMicrosoftCredentialsForTenant(tenant);

  if (!credentials) {
    throw new Error('Microsoft credentials are not configured for direct Entra token refresh.');
  }

  const refreshToken = await getEntraDirectRefreshToken(tenant);

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

  await saveEntraDirectTokenSet(tenant, {
    accessToken,
    refreshToken: newRefreshToken,
    expiresAt,
    scope,
  });

  return {
    accessToken,
    refreshToken: newRefreshToken,
    expiresAt,
    scope,
  };
}
