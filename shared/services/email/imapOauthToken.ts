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
  isImapOauthCredentialIssuerBound,
} from './imapOutboundTarget';

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

type ImapOauthCredentialConfig = {
  id?: string;
  email_provider_id?: string;
  tenant: string;
  oauth_token_url?: string | null;
  oauth_credentials_token_url?: string | null;
  oauth_credentials_secret_version?: number | null;
  oauth_client_secret?: string | null;
  refresh_token?: string | null;
};

/**
 * A newly saved application secret can start authorization before mailbox
 * tokens exist. Persistence clears this DB value on endpoint changes. Secret
 * store fallbacks and existing refresh tokens require an active issuer binding.
 */
export async function getImapOauthAuthorizationCredentials(
  provider: ImapOauthCredentialConfig,
): Promise<{ clientSecret: string | null; refreshToken: string | null }> {
  if (!isImapOauthCredentialIssuerBound(provider)) {
    return {
      clientSecret: provider.oauth_credentials_token_url == null ? provider.oauth_client_secret || null : null,
      refreshToken: null,
    };
  }
  const names = getImapOauthSecretNames(provider);
  const secretProvider = await getSecretProviderInstance();
  const clientSecret =
    (await secretProvider.getTenantSecret(provider.tenant, names.clientSecret)) || provider.oauth_client_secret || null;
  const refreshToken =
    (await secretProvider.getTenantSecret(provider.tenant, names.refreshToken)) || provider.refresh_token || null;
  return { clientSecret, refreshToken };
}

export async function getImapOauthSecrets(
  provider: ImapOauthCredentialConfig,
): Promise<{ clientSecret: string | null; refreshToken: string | null }> {
  assertImapOauthCredentialIssuerBound(provider);
  return getImapOauthAuthorizationCredentials(provider);
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

  const { clientSecret, refreshToken } = await getImapOauthSecrets(provider);
  if (!refreshToken) {
    throw new Error('IMAP OAuth refresh token missing');
  }

  const paramsBody = new URLSearchParams();
  paramsBody.append('grant_type', 'refresh_token');
  paramsBody.append('refresh_token', refreshToken);
  paramsBody.append('client_id', provider.oauth_client_id);
  if (clientSecret) {
    paramsBody.append('client_secret', clientSecret);
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
