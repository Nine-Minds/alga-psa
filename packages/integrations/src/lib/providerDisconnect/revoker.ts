import axios from 'axios';
import logger from '@alga-psa/core/logger';
import {
  resolveQboOAuthCredentials,
  QBO_CREDENTIALS_SECRET_NAME,
} from '../qbo/qboClientService';
import {
  resolveXeroOAuthCredentials,
  XERO_CREDENTIALS_SECRET_NAME,
  XERO_TOKEN_URL,
} from '../xero/xeroClientService';
import { XERO_GRANT_TARGET_ID } from './types';

const QBO_TOKEN_REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections';
const XERO_REVOCATION_URL = 'https://identity.xero.com/connect/revocation';

export type RevokeOutcome = 'revoked' | 'transient_failure' | 'permanent_failure';

export interface RevokeResult {
  outcome: RevokeOutcome;
  /** Sanitized error class; never an HTTP body, token, or raw error object. */
  errorClass: string | null;
}

/**
 * Maps an axios error to a sanitized, retryable-vs-terminal class. Timeouts,
 * network errors, 429s and 5xx are transient; the rest are permanent. A 400
 * with `invalid_grant` means the grant is already dead provider-side, which
 * callers treat as idempotent success.
 */
function classifyAxiosError(
  error: unknown,
  context: { provider: 'quickbooks_online' | 'xero'; operation: string; tenantId: string; targetId: string },
): RevokeResult {
  const errorClass = (): string => {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const data = error.response?.data as { error?: string; Error?: string } | undefined;
      const providerError = data?.error ?? data?.Error;
      if (typeof providerError === 'string' && providerError.trim()) {
        return `${context.provider}_${String(status ?? 'error')}_${providerError}`.slice(0, 90);
      }
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        return `${context.provider}_timeout`;
      }
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
        return `${context.provider}_network`;
      }
      return `${context.provider}_http_${String(status ?? 'unknown')}`;
    }
    return `${context.provider}_unknown`;
  };

  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const data = error.response?.data as { error?: string; Error?: string } | undefined;
    const isInvalidGrant =
      status === 400 &&
      (data?.error === 'invalid_grant' ||
        data?.Error === 'invalid_grant' ||
        JSON.stringify(data).includes('invalid_grant'));

    if (isInvalidGrant) {
      logger.info('[providerDisconnect] Provider reports grant already invalid (idempotent success)', {
        tenantId: context.tenantId,
        provider: context.provider,
        operation: context.operation,
        targetId: context.targetId,
      });
      return { outcome: 'revoked', errorClass: null };
    }

    if (status === 429 || (status !== undefined && status >= 500)) {
      logger.warn('[providerDisconnect] Transient provider failure during disconnect', {
        tenantId: context.tenantId,
        provider: context.provider,
        operation: context.operation,
        targetId: context.targetId,
        status,
        errorClass: errorClass(),
      });
      return { outcome: 'transient_failure', errorClass: errorClass() };
    }

    if (
      error.code === 'ECONNABORTED' ||
      error.code === 'ETIMEDOUT' ||
      error.code === 'ECONNREFUSED' ||
      error.code === 'ENOTFOUND' ||
      error.code === 'EAI_AGAIN' ||
      error.code === 'ERR_NETWORK'
    ) {
      logger.warn('[providerDisconnect] Transient network failure during disconnect', {
        tenantId: context.tenantId,
        provider: context.provider,
        operation: context.operation,
        targetId: context.targetId,
        errorClass: errorClass(),
      });
      return { outcome: 'transient_failure', errorClass: errorClass() };
    }
  }

  logger.warn('[providerDisconnect] Permanent provider failure during disconnect', {
    tenantId: context.tenantId,
    provider: context.provider,
    operation: context.operation,
    targetId: context.targetId,
    errorClass: errorClass(),
  });
  return { outcome: 'permanent_failure', errorClass: errorClass() };
}

// ── QuickBooks Online ─────────────────────────────────────────────────────────

export interface QboRevokeMaterial {
  realmId: string;
  refreshToken: string;
}

/**
 * Reads the tombstoned QBO credential map (realmId → credentials). Falls back
 * to the live secret for compatibility with a disconnect that never tombstoned
 * (a pre-existing record from an earlier version).
 */
export async function readQboRevokeMaterial(
  tenantId: string,
  secretProvider: { getTenantSecret(tenant: string, name: string): Promise<unknown> },
  tombstoneSecretName: string,
): Promise<Record<string, QboRevokeMaterial>> {
  const raw = await secretProvider.getTenantSecret(tenantId, tombstoneSecretName);
  const secret = raw ?? (await secretProvider.getTenantSecret(tenantId, QBO_CREDENTIALS_SECRET_NAME));
  if (!secret) return {};
  try {
    const parsed = typeof secret === 'string' ? JSON.parse(secret) : secret;
    if (!parsed || typeof parsed !== 'object') return {};
    const result: Record<string, QboRevokeMaterial> = {};
    for (const [realmId, entry] of Object.entries(parsed as Record<string, any>)) {
      if (typeof entry?.refreshToken === 'string' && entry.refreshToken) {
        result[realmId] = { realmId, refreshToken: entry.refreshToken };
      }
    }
    return result;
  } catch {
    return {};
  }
}

export async function revokeQboRealm(
  tenantId: string,
  material: QboRevokeMaterial,
): Promise<RevokeResult> {
  const context = {
    provider: 'quickbooks_online' as const,
    operation: 'revoke_token',
    tenantId,
    targetId: material.realmId,
  };

  let resolved: Awaited<ReturnType<typeof resolveQboOAuthCredentials>>;
  try {
    resolved = await resolveQboOAuthCredentials(tenantId);
  } catch {
    return {
      outcome: 'permanent_failure',
      errorClass: 'quickbooks_online_config_missing',
    };
  }

  const authHeader = `Basic ${Buffer.from(`${resolved.clientId}:${resolved.clientSecret}`).toString('base64')}`;
  try {
    await axios.post(
      QBO_TOKEN_REVOKE_URL,
      { token: material.refreshToken },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: authHeader,
        },
        timeout: 10000,
      },
    );
    return { outcome: 'revoked', errorClass: null };
  } catch (error) {
    const classified = classifyAxiosError(error, context);
    if (classified.outcome === 'revoked') {
      // invalid_grant: Intuit already dropped the grant — idempotent success.
      return classified;
    }
    return classified;
  }
}

// ── Xero ──────────────────────────────────────────────────────────────────────

export interface XeroRevokeMaterial {
  connectionId: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt?: string;
}

export async function readXeroRevokeMaterial(
  tenantId: string,
  secretProvider: { getTenantSecret(tenant: string, name: string): Promise<unknown> },
  tombstoneSecretName: string,
): Promise<Record<string, XeroRevokeMaterial>> {
  const raw = await secretProvider.getTenantSecret(tenantId, tombstoneSecretName);
  const secret = raw ?? (await secretProvider.getTenantSecret(tenantId, XERO_CREDENTIALS_SECRET_NAME));
  if (!secret) return {};
  try {
    const parsed = typeof secret === 'string' ? JSON.parse(secret) : secret;
    if (!parsed || typeof parsed !== 'object') return {};
    const result: Record<string, XeroRevokeMaterial> = {};
    for (const [connectionId, entry] of Object.entries(parsed as Record<string, any>)) {
      if (entry && typeof entry === 'object' && typeof entry.connectionId === 'string') {
        result[connectionId] = {
          connectionId: entry.connectionId,
          accessToken: entry.accessToken,
          accessTokenExpiresAt: entry.accessTokenExpiresAt,
          refreshToken: entry.refreshToken,
          refreshTokenExpiresAt: entry.refreshTokenExpiresAt,
        };
      }
    }
    return result;
  } catch {
    return {};
  }
}

function isAccessTokenExpired(material: XeroRevokeMaterial): boolean {
  // An emptied access token (e.g. after a 401) is always "expired" so the
  // refresh path re-fetches rather than retrying with an empty bearer.
  if (!material.accessToken) return true;
  if (!material.accessTokenExpiresAt) return true;
  const expiresAt = new Date(material.accessTokenExpiresAt).getTime();
  return Date.now() >= expiresAt - 5 * 60 * 1000;
}

/**
 * Refreshes a Xero access token from the tombstoned refresh token, so a stale
 * access token is never the reason a connection delete is skipped.
 */
async function ensureXeroAccessToken(
  tenantId: string,
  material: XeroRevokeMaterial,
): Promise<{ accessToken: string; result: RevokeResult | null }> {
  if (!isAccessTokenExpired(material)) {
    return { accessToken: material.accessToken, result: null };
  }

  const context = {
    provider: 'xero' as const,
    operation: 'refresh_token',
    tenantId,
    targetId: material.connectionId,
  };

  let resolved: Awaited<ReturnType<typeof resolveXeroOAuthCredentials>>;
  try {
    resolved = await resolveXeroOAuthCredentials(tenantId);
  } catch {
    return { accessToken: '', result: { outcome: 'permanent_failure', errorClass: 'xero_config_missing' } };
  }

  try {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: material.refreshToken,
      client_id: resolved.clientId,
      client_secret: resolved.clientSecret,
    });
    const response = await axios.post(XERO_TOKEN_URL, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10000,
    });
    const accessToken = response.data?.access_token;
    if (typeof accessToken !== 'string' || !accessToken) {
      return { accessToken: '', result: { outcome: 'permanent_failure', errorClass: 'xero_refresh_missing_token' } };
    }
    return { accessToken, result: null };
  } catch (error) {
    const classified = classifyAxiosError(error, context);
    // invalid_grant here means the refresh token is dead — the connection can
    // no longer be confirmed deleted with a valid bearer token, so this is a
    // permanent condition requiring operator force-finalize.
    if (classified.outcome === 'revoked') {
      return { accessToken: '', result: { outcome: 'permanent_failure', errorClass: 'xero_refresh_invalid_grant' } };
    }
    return { accessToken: '', result: classified };
  }
}

export async function revokeXeroConnection(
  tenantId: string,
  material: XeroRevokeMaterial,
): Promise<RevokeResult> {
  const context = {
    provider: 'xero' as const,
    operation: 'delete_connection',
    tenantId,
    targetId: material.connectionId,
  };

  const refreshed = await ensureXeroAccessToken(tenantId, material);
  if (refreshed.result) {
    return refreshed.result;
  }

  const attemptDelete = async (
    accessToken: string,
    allowUnauthorizedRetry: boolean,
  ): Promise<RevokeResult> => {
    try {
      await axios.delete(`${XERO_CONNECTIONS_URL}/${encodeURIComponent(material.connectionId)}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
        timeout: 10000,
      });
      return { outcome: 'revoked', errorClass: null };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        // Already removed provider-side — idempotent success.
        return { outcome: 'revoked', errorClass: null };
      }
      if (axios.isAxiosError(error) && error.response?.status === 401 && allowUnauthorizedRetry) {
        // One forced-refresh retry: a long-lived access token can slip past
        // expiry right after we read it; refresh again and try once more.
        const retried = await ensureXeroAccessToken(tenantId, { ...material, accessToken: '' });
        if (retried.result) {
          return retried.result;
        }
        return attemptDelete(retried.accessToken, false);
      }
      return classifyAxiosError(error, context);
    }
  };

  return attemptDelete(refreshed.accessToken, true);
}

export async function revokeXeroGrant(
  tenantId: string,
  refreshToken: string,
): Promise<RevokeResult> {
  const context = {
    provider: 'xero' as const,
    operation: 'revoke_grant',
    tenantId,
    targetId: XERO_GRANT_TARGET_ID,
  };

  let resolved: Awaited<ReturnType<typeof resolveXeroOAuthCredentials>>;
  try {
    resolved = await resolveXeroOAuthCredentials(tenantId);
  } catch {
    return { outcome: 'permanent_failure', errorClass: 'xero_config_missing' };
  }

  const authHeader = `Basic ${Buffer.from(`${resolved.clientId}:${resolved.clientSecret}`).toString('base64')}`;
  try {
    const params = new URLSearchParams({
      token: refreshToken,
      token_type_hint: 'refresh_token',
    });
    await axios.post(XERO_REVOCATION_URL, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: authHeader,
      },
      timeout: 10000,
    });
    return { outcome: 'revoked', errorClass: null };
  } catch (error) {
    return classifyAxiosError(error, context);
  }
}

export interface XeroConnectionLike {
  connectionId: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt?: string;
}

export function toXeroRevokeMaterial(connection: XeroConnectionLike): XeroRevokeMaterial {
  return {
    connectionId: connection.connectionId,
    accessToken: connection.accessToken,
    accessTokenExpiresAt: connection.accessTokenExpiresAt,
    refreshToken: connection.refreshToken,
    refreshTokenExpiresAt: connection.refreshTokenExpiresAt,
  };
}
