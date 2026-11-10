/**
 * IMAP OAuth token refresh, shared by the inbound queue processor and the
 * provider lifecycle recovery path. Extracted so both callers use the same
 * secret resolution and persistence behavior without import cycles.
 */

import axios from 'axios';
import https from 'node:https';
import { tenantDb } from '@alga-psa/db';
import type { getAdminConnection } from '@alga-psa/db/admin';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import {
  assertImapOauthCredentialIssuerBound,
  assertSafeImapOauthTokenEndpoint,
  getImapOauthSecretNames,
} from './imapOutboundTarget';

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function getImapOauthSecrets(provider: {
  id: string;
  tenant: string;
  oauth_token_url?: string | null;
  oauth_credentials_token_url?: string | null;
  oauth_credentials_secret_version?: number | null;
}): Promise<{ clientSecret: string | null; refreshToken: string | null }> {
  assertImapOauthCredentialIssuerBound(provider);
  const names = getImapOauthSecretNames(provider);
  const secretProvider = await getSecretProviderInstance();
  const clientSecret =
    (await secretProvider.getTenantSecret(provider.tenant, names.clientSecret)) ?? null;
  const refreshToken =
    (await secretProvider.getTenantSecret(provider.tenant, names.refreshToken)) ?? null;
  return { clientSecret, refreshToken };
}

export async function refreshImapAccessToken(params: {
  provider: {
    id: string;
    tenant: string;
    oauth_token_url?: string | null;
    oauth_credentials_token_url?: string | null;
    oauth_credentials_secret_version?: number | null;
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

  // Check the durable DB binding before reading secrets: CompositeSecretProvider
  // may still return an environment fallback after its write provider deletes a key.
  assertImapOauthCredentialIssuerBound(provider);
  const tokenTarget = await assertSafeImapOauthTokenEndpoint(provider.oauth_token_url);

  const { clientSecret, refreshToken } = await getImapOauthSecrets({
    id: provider.id,
    tenant: provider.tenant,
    oauth_token_url: provider.oauth_token_url,
    oauth_credentials_token_url: provider.oauth_credentials_token_url,
    oauth_credentials_secret_version: provider.oauth_credentials_secret_version,
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

  const response = await axios.post(provider.oauth_token_url, paramsBody, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    maxRedirects: 0,
    proxy: false,
    httpsAgent: new https.Agent({ lookup: tokenTarget.lookup as any }),
  });
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
