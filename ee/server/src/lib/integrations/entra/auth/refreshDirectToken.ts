import axios from 'axios';
import { getMicrosoftTokenUrl } from '@alga-psa/shared/services/email/microsoftGraphEndpoints';
import { EntraOperatorError } from '../entraOperatorError';
import { resolveMicrosoftCredentialsForTenant } from './microsoftCredentialResolver';
import {
  getEntraDirectRefreshToken,
  saveEntraDirectRefreshToken,
  saveEntraDirectTokenSet,
} from './tokenStore';
import { ENTRA_DIRECT_SCOPE_STRING } from './directScopes';

export interface RefreshDirectTokenResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scope: string | null;
}

async function refreshEntraDirectTokenForAuthority(
  tenant: string,
  authorityTenant = 'common',
  persistAccessToken = true
): Promise<RefreshDirectTokenResult> {
  const credentials = await resolveMicrosoftCredentialsForTenant(tenant);

  if (!credentials) {
    throw new Error('Select the Microsoft app registration to use for Entra, then reconnect.');
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
    scope: ENTRA_DIRECT_SCOPE_STRING,
  });

  let response;
  try {
    response = await axios.post(
      getMicrosoftTokenUrl(authorityTenant),
      tokenParams.toString(),
      {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      }
    );
  } catch (error: unknown) {
    // A revoked or expired grant is the most common way a working connection
    // stops working, and it is the one an operator can fix. Left as the raw
    // axios error it reaches the run history as "Request failed with status
    // code 400", which names neither the cause nor the remedy.
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const data = (error.response?.data ?? {}) as {
        error?: string;
        suberror?: string;
        error_description?: string;
      };
      const oauthError = data.error;
      if (status === 400 || status === 401) {
        // The bare OAuth error ("invalid_grant") does not discriminate between
        // the failure modes an operator must tell apart: a revoked grant
        // (reconnect fixes it), missing admin consent in the managed tenant
        // (AADSTS65001/consent_required — reconnecting changes nothing), or a
        // conditional-access/MFA demand from that tenant (AADSTS50076/50079).
        // Surface Microsoft's suberror and AADSTS code so the run history says
        // which one this is.
        const aadsts = /AADSTS\d+/.exec(data.error_description || '')?.[0];
        const detail = [oauthError, data.suberror, aadsts].filter(Boolean).join(', ');
        const consentDenied =
          data.suberror === 'consent_required' || aadsts === 'AADSTS65001';
        // Thrown as EntraOperatorError so entraRouteErrorMessage lets it reach
        // the operator: as a plain Error the preflight/API routes collapse it
        // to their generic fallback, and only the worker's run history keeps
        // the real reason.
        throw new EntraOperatorError(
          'credential-rejected',
          'Microsoft rejected the stored credentials for this connection'
          + (detail ? ` (${detail})` : '')
          + (consentDenied
            ? '. The app has not been granted admin consent in the managed tenant — grant consent there, then retry; reconnecting will not help.'
            : '. Reconnect Microsoft Entra to resume syncing.')
        );
      }
      throw new EntraOperatorError(
        'unreachable',
        `Microsoft could not refresh the connection's access token${
          status ? ` (HTTP ${status})` : ''
        }. The sync will retry on its next run.`
      );
    }
    throw error;
  }

  const accessToken = response.data?.access_token as string | undefined;
  const newRefreshToken =
    (response.data?.refresh_token as string | undefined) || refreshToken;
  const expiresIn = response.data?.expires_in as number | undefined;
  const scope = (response.data?.scope as string | undefined) || null;

  if (!accessToken || !expiresIn) {
    throw new Error('Direct Entra token refresh response was missing required fields.');
  }

  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  if (persistAccessToken) {
    await saveEntraDirectTokenSet(tenant, {
      accessToken,
      refreshToken: newRefreshToken,
      expiresAt,
      scope,
    });
  } else if (newRefreshToken !== refreshToken) {
    await saveEntraDirectRefreshToken(tenant, newRefreshToken);
  }

  return {
    accessToken,
    refreshToken: newRefreshToken,
    expiresAt,
    scope,
  };
}

export async function refreshEntraDirectToken(
  tenant: string
): Promise<RefreshDirectTokenResult> {
  return refreshEntraDirectTokenForAuthority(tenant);
}

export async function refreshEntraDirectAccessTokenForTenant(
  tenant: string,
  authorityTenant: string
): Promise<RefreshDirectTokenResult> {
  return refreshEntraDirectTokenForAuthority(tenant, authorityTenant, false);
}
