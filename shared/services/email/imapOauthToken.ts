/**
 * IMAP OAuth token refresh, shared by the inbound queue processor and the
 * provider lifecycle recovery path. Extracted so both callers use the same
 * secret resolution and persistence behavior without import cycles.
 */

import { tenantDb } from '@alga-psa/db';
import type { getAdminConnection } from '@alga-psa/db/admin';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { assertPublicHttpsUrl, postSafeOutboundForm } from '@alga-psa/core/net/safeFetch';

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function getImapOauthSecrets(provider: {
  id: string;
  tenant: string;
}): Promise<{ clientSecret: string | null; refreshToken: string | null }> {
  const secretProvider = await getSecretProviderInstance();
  const clientSecret =
    (await secretProvider.getTenantSecret(provider.tenant, `imap_oauth_client_secret_${provider.id}`)) ?? null;
  const refreshToken =
    (await secretProvider.getTenantSecret(provider.tenant, `imap_refresh_token_${provider.id}`)) ?? null;
  return { clientSecret, refreshToken };
}

export async function refreshImapAccessToken(params: {
  provider: {
    id: string;
    tenant: string;
    oauth_token_url?: string | null;
    oauth_client_id?: string | null;
    oauth_client_secret?: string | null;
    refresh_token?: string | null;
    access_token?: string | null;
    token_expires_at?: string | null;
  };
  db: Awaited<ReturnType<typeof getAdminConnection>>;
}): Promise<string> {
  const { provider, db } = params;
  if (!provider.oauth_token_url || !provider.oauth_client_id) {
    throw new Error('IMAP OAuth token URL or client ID missing');
  }

  // Reject legacy unsafe URLs before reading tenant credentials. The POST
  // resolves again immediately before sending and pins the selected address.
  await assertPublicHttpsUrl(provider.oauth_token_url);

  const { clientSecret, refreshToken } = await getImapOauthSecrets({
    id: provider.id,
    tenant: provider.tenant,
  });
  const effectiveRefreshToken = refreshToken || provider.refresh_token;
  const effectiveClientSecret = clientSecret || provider.oauth_client_secret;
  if (!effectiveRefreshToken) {
    throw new Error('IMAP OAuth refresh token missing');
  }

  const paramsBody = new URLSearchParams();
  paramsBody.append('grant_type', 'refresh_token');
  paramsBody.append('refresh_token', effectiveRefreshToken);
  paramsBody.append('client_id', provider.oauth_client_id);
  if (effectiveClientSecret) {
    paramsBody.append('client_secret', effectiveClientSecret);
  }

  let response;
  try {
    response = await postSafeOutboundForm<{ access_token?: string; expires_in?: number }>(provider.oauth_token_url, paramsBody);
  } catch {
    throw new Error('IMAP OAuth token refresh failed');
  }
  const accessToken = asNonEmptyString(response?.data?.access_token);
  if (!accessToken) {
    throw new Error('IMAP OAuth refresh returned no access token');
  }

  const expiresInSeconds = Number(response?.data?.expires_in || 3600);
  const expiresAt = new Date(
    Date.now() + (Number.isFinite(expiresInSeconds) ? expiresInSeconds : 3600) * 1000
  ).toISOString();

  await tenantDb(db, provider.tenant).table('imap_email_provider_config')
    .where({ email_provider_id: provider.id })
    .update({
      access_token: accessToken,
      token_expires_at: expiresAt,
      updated_at: db.fn.now(),
    });

  provider.access_token = accessToken;
  provider.token_expires_at = expiresAt;
  console.info('[ImapOauthToken] refreshed IMAP OAuth access token', {
    event: 'imap_oauth_refresh',
    tenantId: provider.tenant,
    providerId: provider.id,
    expiresAt,
  });

  return accessToken;
}
