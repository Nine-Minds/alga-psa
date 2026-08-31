export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import logger from '@alga-psa/core/logger';
import { AppError } from '@alga-psa/core';

import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { createTenantKnex } from '@alga-psa/db';

import {
  getXeroRedirectUri,
  XeroConnectionsStore,
  resolveXeroOAuthCredentials,
  upsertStoredXeroConnections,
  getXeroTokenUrl,
  getXeroConnectionsUrl,
} from '../../../../lib/xero/xeroClientService';
import {
  getProviderCredentialWriteDisposition,
  PROVIDER_XERO,
  withProviderCredentialLock
} from '../../../../lib/providerDisconnect';
import { oauthCsrfTokensMatch, buildOauthCsrfCookieOptions } from '../../../../lib/oauth/oauthCsrf';
import { XERO_OAUTH_CSRF_COOKIE } from '../../../../lib/xero/oauthCsrf';
import {
  authorizeAccountingOAuthCallback,
  reauthorizeAccountingOAuthCallback,
  revokeAccountingOAuthGrant,
  type AccountingOAuthAuthzErrorCode
} from '../../../../lib/accountingConnectionAuth';
import { consumeAccountingOAuthNonce } from '../../../../lib/accountingOAuthStateStore';

const NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';

const SUCCESS_PATH =
  '/msp/settings?tab=integrations&category=accounting&accounting_integration=xero&xero_status=success';
const FAILURE_PATH =
  '/msp/settings?tab=integrations&category=accounting&accounting_integration=xero&xero_status=failure';

// Neutral, actionable callback error params surfaced in the settings UI. They
// never include provider-side org/company details.
const AUTHZ_ERROR_TO_PARAM: Record<AccountingOAuthAuthzErrorCode, string> = {
  STATE_REPLAYED: 'state_replayed',
  AUTH_REQUIRED: 'session_expired',
  USER_MISMATCH: 'user_mismatch',
  TENANT_MISMATCH: 'tenant_mismatch',
  FORBIDDEN: 'forbidden'
};

type XeroStatePayload = {
  tenantId: string;
  userId: string;
  csrf: string;
  codeVerifier: string;
  nonce: string;
  initiatedAt: string;
};

function isEnterpriseEdition(): boolean {
  return (
    (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
    (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise'
  );
}

function createRedirect(path: string, params?: Record<string, string | undefined>) {
  const url = new URL(path, NEXTAUTH_URL);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, value);
      }
    }
  }
  const response = NextResponse.redirect(url);
  // The CSRF cookie is single-use: clear it on every outcome.
  response.cookies.set(
    XERO_OAUTH_CSRF_COOKIE.name,
    '',
    buildOauthCsrfCookieOptions(XERO_OAUTH_CSRF_COOKIE, { clear: true })
  );
  return response;
}

// A provider-side denial (error param) still leaves no reusable state: burn the
// state nonce when the state is present, best-effort. The Xero state is not
// signed, so only burn when the presenter holds the CSRF cookie — the same gate
// the success path enforces — otherwise a captured state URL could be used to
// burn a victim's state.
async function burnXeroOAuthStateIfPresent(request: NextRequest): Promise<void> {
  try {
    const state = new URL(request.url).searchParams.get('state');
    if (!state) {
      return;
    }
    const payload = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8')) as {
      csrf?: unknown;
      nonce?: unknown;
    };
    if (typeof payload?.nonce !== 'string' || !payload.nonce) {
      return;
    }
    const csrfCookie = request.cookies.get(XERO_OAUTH_CSRF_COOKIE.name)?.value;
    if (
      typeof payload.csrf !== 'string' ||
      !csrfCookie ||
      !oauthCsrfTokensMatch(csrfCookie, payload.csrf)
    ) {
      return;
    }
    await consumeAccountingOAuthNonce('xero', payload.nonce);
  } catch {
    // Best-effort only: denial redirects must never fail because a burn did.
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    return await handleCallbackRequest(request);
  } catch (error) {
    logger.error('[xeroOAuth] Unexpected Xero OAuth callback failure', { error });
    return createRedirect(FAILURE_PATH, { xero_error: 'unexpected_failure' });
  }
}

async function handleCallbackRequest(request: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) {
    return NextResponse.json(
      { error: 'Xero integration is only available in Enterprise Edition.' },
      { status: 501 }
    );
  }

  const { searchParams } = new URL(request.url);
  const errorParam = searchParams.get('error');
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  if (errorParam) {
    await burnXeroOAuthStateIfPresent(request);
    return createRedirect(FAILURE_PATH, { xero_error: errorParam });
  }

  if (!code || !state) {
    return createRedirect(FAILURE_PATH, { xero_error: 'missing_params' });
  }

  let statePayload: XeroStatePayload;
  try {
    statePayload = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8')) as XeroStatePayload;
    if (
      !statePayload?.tenantId ||
      typeof statePayload.tenantId !== 'string' ||
      !statePayload?.userId ||
      typeof statePayload.userId !== 'string' ||
      typeof statePayload.csrf !== 'string' ||
      !statePayload.csrf ||
      !statePayload?.codeVerifier ||
      !statePayload?.nonce ||
      typeof statePayload.initiatedAt !== 'string' ||
      !Number.isFinite(Date.parse(statePayload.initiatedAt))
    ) {
      throw new Error('state missing required fields');
    }
  } catch (error) {
    console.error('[xeroOAuth] failed to decode state', error);
    return createRedirect(FAILURE_PATH, { xero_error: 'invalid_state' });
  }

  const tenantId = statePayload.tenantId;

  // Verify the CSRF token in the state against the HttpOnly cookie set by the
  // connect route. Only the initiating browser holds the cookie, so a forged
  // or replayed callback URL fails here.
  const csrfCookie = request.cookies.get(XERO_OAUTH_CSRF_COOKIE.name)?.value;
  if (!csrfCookie || !oauthCsrfTokensMatch(csrfCookie, statePayload.csrf)) {
    logger.warn('[xeroOAuth] CSRF token mismatch on callback', { tenantId });
    return createRedirect(FAILURE_PATH, { xero_error: 'csrf_mismatch' });
  }

  // Re-authorize the current live user before exchanging the code: the state is
  // atomically consumed here, and the callback proceeds only if the live user
  // is still the initiating user in the initiating tenant with the
  // connection-admin permission.
  const authz = await authorizeAccountingOAuthCallback({
    provider: 'xero',
    tenantId: statePayload.tenantId,
    userId: statePayload.userId,
    nonce: statePayload.nonce,
    initiatedAt: statePayload.initiatedAt
  });
  if (!authz.ok) {
    let errorParam = AUTHZ_ERROR_TO_PARAM[authz.code];
    if (authz.code === 'STATE_REPLAYED') {
      // Disconnect initiation invalidates outstanding nonces. Distinguish that
      // deliberate invalidation from an ordinary replay while the disconnect
      // is still active, without ever reaching the provider token endpoint.
      const { knex } = await createTenantKnex(tenantId);
      const disposition = await withProviderCredentialLock(
        knex,
        tenantId,
        PROVIDER_XERO,
        (trx) => getProviderCredentialWriteDisposition(
          trx,
          tenantId,
          PROVIDER_XERO,
          statePayload.initiatedAt
        )
      ).catch(() => 'disconnect_in_progress' as const);
      if (disposition === 'disconnect_in_progress') {
        errorParam = disposition;
      }
    }
    logger.warn('[xeroOAuth] Callback authorization failed', {
      tenantId,
      code: authz.code
    });
    return createRedirect(FAILURE_PATH, { xero_error: errorParam });
  }

  // Check the trusted flow start under the same lock as disconnect initiation.
  // This rejects active disconnects and pre-disconnect flows even after their
  // record finalized. The storage layer repeats the check atomically with the
  // credential write in case a disconnect starts after this early gate.
  const { knex } = await createTenantKnex(tenantId);
  const writeDisposition = await withProviderCredentialLock(knex, tenantId, PROVIDER_XERO, (trx) =>
    getProviderCredentialWriteDisposition(trx, tenantId, PROVIDER_XERO, authz.flowInitiatedAt)
  ).catch(() => 'disconnect_in_progress' as const);
  if (writeDisposition !== 'allowed') {
    logger.info('[xeroOAuth] Callback blocked by credential-write provenance gate', {
      tenantId,
      disposition: writeDisposition
    });
    return createRedirect(FAILURE_PATH, {
      xero_error: writeDisposition === 'stale_authorization' ? 'state_replayed' : writeDisposition
    });
  }

  const secretProvider = await getSecretProviderInstance();
  const redirectUri = await getXeroRedirectUri(secretProvider);

  let credentials;
  try {
    credentials = await resolveXeroOAuthCredentials(tenantId, secretProvider);
  } catch (error) {
    logger.warn('[xeroOAuth] Callback received without usable credentials', {
      tenantId,
      error: error instanceof Error ? error.message : error
    });
    return createRedirect(FAILURE_PATH, { xero_error: 'config_missing' });
  }

  try {
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: String(credentials.clientId),
      client_secret: String(credentials.clientSecret),
      code_verifier: statePayload.codeVerifier
    });

    const tokenResponse = await axios.post(
      getXeroTokenUrl(),
      tokenParams.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );

    const tokenData = tokenResponse.data ?? {};
    const accessToken: string | undefined = tokenData.access_token;
    const refreshToken: string | undefined = tokenData.refresh_token;
    if (!accessToken || !refreshToken) {
      console.error('[xeroOAuth] token response missing access or refresh token', tokenData);
      return createRedirect(FAILURE_PATH, { xero_error: 'token_exchange_failed' });
    }

    const expiresInSeconds =
      typeof tokenData.expires_in === 'number' ? tokenData.expires_in : 1800;
    const refreshExpiresInSeconds =
      typeof tokenData.refresh_token_expires_in === 'number'
        ? tokenData.refresh_token_expires_in
        : 60 * 60 * 24 * 90;
    const now = Date.now();
    const accessTokenExpiresAt = new Date(now + expiresInSeconds * 1000).toISOString();
    const refreshTokenExpiresAt = new Date(now + refreshExpiresInSeconds * 1000).toISOString();
    const scope =
      typeof tokenData.scope === 'string'
        ? tokenData.scope
        : Array.isArray(tokenData.scope)
          ? tokenData.scope.join(' ')
          : undefined;

    const connectionsResponse = await axios.get(getXeroConnectionsUrl(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json'
      }
    });

    const connections: Array<{ id?: string; tenantId?: string; tenantName?: string }> = Array.isArray(
      connectionsResponse.data
    )
      ? connectionsResponse.data
      : [];

    if (!connections.length) {
      console.error('[xeroOAuth] no connections returned for tenant', tenantId);
      return createRedirect(FAILURE_PATH, { xero_error: 'no_connections' });
    }

    const connectionUpdates: XeroConnectionsStore = {};
    for (const connection of connections) {
      if (!connection?.id || !connection?.tenantId) {
        continue;
      }

      connectionUpdates[connection.id] = {
        connectionId: connection.id,
        xeroTenantId: connection.tenantId,
        tenantName: connection.tenantName,
        accessToken,
        refreshToken,
        accessTokenExpiresAt,
        refreshTokenExpiresAt,
        scope
      };
    }

    if (!Object.keys(connectionUpdates).length) {
      console.error('[xeroOAuth] unable to map Xero connections for tenant', tenantId);
      return createRedirect(FAILURE_PATH, { xero_error: 'connections_unmapped' });
    }

    // Re-check authorization immediately before persisting. If a denial lands
    // here (permission/user/tenant changed between the exchange and the write),
    // revoke the just-obtained grant provider-side and store nothing.
    const reauthz = await reauthorizeAccountingOAuthCallback({
      tenantId,
      userId: statePayload.userId
    });
    if (!reauthz.ok) {
      await revokeAccountingOAuthGrant({
        provider: 'xero',
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        refreshToken
      });
      logger.warn('[xeroOAuth] Persistence-time authorization failed; grant revoked', {
        tenantId,
        code: reauthz.code
      });
      return createRedirect(FAILURE_PATH, { xero_error: AUTHZ_ERROR_TO_PARAM[reauthz.code] });
    }

    await upsertStoredXeroConnections(tenantId, connectionUpdates, {
      prioritize: Object.keys(connectionUpdates),
      authorizationFlowStartedAt: authz.flowInitiatedAt
    });

    logger.info('[xeroOAuth] Completed Xero OAuth callback', {
      tenantId,
      credentialSource: credentials.source,
      connectionCount: Object.keys(connectionUpdates).length,
      defaultConnectionId: Object.keys(connectionUpdates)[0]
    });

    return createRedirect(SUCCESS_PATH);
  } catch (error) {
    // The storage layer refuses the write when a disconnect started after the
    // route-level gate above passed (its check-and-write is atomic with
    // disconnect initiation). Surface the same accurate status as the
    // route-level rejection instead of a generic failure.
    if (error instanceof AppError && error.code === 'XERO_DISCONNECT_IN_PROGRESS') {
      logger.info('[xeroOAuth] Callback blocked at credential storage: Xero disconnect in progress', { tenantId });
      return createRedirect(FAILURE_PATH, { xero_error: 'disconnect_in_progress' });
    }
    if (error instanceof AppError && error.code === 'XERO_STALE_AUTHORIZATION') {
      logger.info('[xeroOAuth] Callback blocked at credential storage: stale Xero authorization', { tenantId });
      return createRedirect(FAILURE_PATH, { xero_error: 'state_replayed' });
    }
    logger.error('[xeroOAuth] Failed to complete OAuth callback', {
      tenantId,
      error: error instanceof Error ? error.message : 'unknown_error'
    });
    return createRedirect(FAILURE_PATH, { xero_error: 'oauth_failed' });
  }
}
