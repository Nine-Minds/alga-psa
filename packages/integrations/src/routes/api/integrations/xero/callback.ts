export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import logger from '@alga-psa/core/logger';

import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { hasPermission } from '@alga-psa/auth/rbac';

import {
  getXeroRedirectUri,
  XeroConnectionsStore,
  resolveXeroOAuthCredentials,
  upsertStoredXeroConnections,
  XERO_TOKEN_URL
} from '../../../../lib/xero/xeroClientService';
import { oauthCsrfTokensMatch } from '../../../../lib/oauth/oauthCsrf';
import { XERO_OAUTH_CSRF_COOKIE } from '../../../../lib/xero/oauthCsrf';
import { consumeXeroConnectAttempt } from '../../../../lib/xero/xeroOAuthConnectAttemptStore';
import { decryptXeroVerifier } from '../../../../lib/xero/xeroOAuthVerifierCipher';

const NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';
const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections';

const SUCCESS_PATH =
  '/msp/settings?tab=integrations&category=accounting&accounting_integration=xero&xero_status=success';
const FAILURE_PATH =
  '/msp/settings?tab=integrations&category=accounting&accounting_integration=xero&xero_status=failure';

// Coarse, non-leaky Xero provider error codes a callback may surface. Anything
// else from the provider maps to a fixed code so the redirect never echoes
// provider-controlled content.
const COARSE_XERO_ERROR_CODES = new Set(['access_denied']);

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
  // The CSRF cookie is deliberately not cleared on callback: a browser may
  // hold several parallel in-flight attempts (two tabs), each bound to the
  // same cookie value, and clearing it after the first callback would fail the
  // rest. It expires by its own 600s TTL.
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  let response: NextResponse;
  try {
    response = await handleCallbackRequest(request);
  } catch (error) {
    logger.error('[xeroOAuth] Unexpected Xero OAuth callback failure', {
      errorCode: error instanceof Error ? error.constructor.name : 'unknown_error'
    });
    response = createRedirect(FAILURE_PATH, { xero_error: 'unexpected_failure' });
  }
  logCallbackAccess(request, response);
  return response;
}

// The dev server's incoming-request access line is suppressed for callback
// paths (they carry one-time credentials on the query string). Preserve
// method/path/status-level diagnostics here; the redirect's coarse xero_error
// code conveys the outcome and never echoes provider- or browser-supplied
// content. Query values are deliberately not included.
function logCallbackAccess(request: NextRequest, response: NextResponse): void {
  const location = response.headers.get('location');
  const xeroError = location
    ? new URL(location, NEXTAUTH_URL).searchParams.get('xero_error') ?? undefined
    : undefined;
  logger.info('[xeroOAuth] Callback handled', {
    method: request.method,
    path: request.nextUrl.pathname,
    status: response.status,
    ...(xeroError ? { xeroError } : {})
  });
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
    // Xero rejected the authorization before any token exchange. The flow is
    // over: consume the bound attempt (only when the initiating browser's CSRF
    // cookie is present) so the state can never be replayed into an exchange,
    // then redirect with a coarse error code.
    if (state && request.cookies.get(XERO_OAUTH_CSRF_COOKIE.name)?.value) {
      await consumeXeroConnectAttempt(state).catch(() => null);
    }
    const coarseCode = COARSE_XERO_ERROR_CODES.has(errorParam) ? errorParam : 'provider_denied';
    return createRedirect(FAILURE_PATH, { xero_error: coarseCode });
  }

  if (!code || !state) {
    return createRedirect(FAILURE_PATH, { xero_error: 'missing_params' });
  }

  // Verify the CSRF cookie set by the connect route is present: only the
  // browser that started the flow holds it. The value is re-checked against
  // the server-side attempt record after atomic consumption.
  const csrfCookie = request.cookies.get(XERO_OAUTH_CSRF_COOKIE.name)?.value;
  if (!csrfCookie) {
    logger.warn('[xeroOAuth] CSRF cookie missing on callback');
    return createRedirect(FAILURE_PATH, { xero_error: 'csrf_mismatch' });
  }

  // Atomically consume the attempt bound to the opaque state nonce before any
  // session, binding, or permission check. A replayed, tampered, expired, or
  // already-consumed state finds no record and fails here, and every terminal
  // failure path below leaves no reusable verifier record behind. The one path
  // that does not consume is a missing CSRF cookie: an attacker who only knows
  // the state nonce must not be able to burn the initiating browser's attempt.
  const attempt = await consumeXeroConnectAttempt(state);
  if (!attempt) {
    logger.warn('[xeroOAuth] Xero OAuth state unknown, expired, or already used');
    return createRedirect(FAILURE_PATH, { xero_error: 'invalid_state' });
  }

  // The callback must be completed by a live authenticated session.
  const sessionUser = await getCurrentUser();
  if (!sessionUser?.tenant) {
    logger.warn('[xeroOAuth] Callback received without an authenticated session');
    return createRedirect(FAILURE_PATH, { xero_error: 'session_expired' });
  }

  // Every binding must hold; all rejections happen before token storage and
  // leave no reusable record behind (the attempt is already consumed).
  if (attempt.expiresAt <= Date.now()) {
    logger.warn('[xeroOAuth] Xero OAuth attempt expired', {
      tenantId: sessionUser.tenant
    });
    return createRedirect(FAILURE_PATH, { xero_error: 'expired_state' });
  }

  if (!oauthCsrfTokensMatch(csrfCookie, attempt.csrf)) {
    logger.warn('[xeroOAuth] CSRF token mismatch on callback', {
      tenantId: sessionUser.tenant
    });
    return createRedirect(FAILURE_PATH, { xero_error: 'csrf_mismatch' });
  }

  if (attempt.provider !== 'xero') {
    logger.warn('[xeroOAuth] OAuth attempt provider mismatch on callback', {
      tenantId: sessionUser.tenant
    });
    return createRedirect(FAILURE_PATH, { xero_error: 'provider_mismatch' });
  }

  if (sessionUser.tenant !== attempt.tenantId) {
    logger.warn('[xeroOAuth] Attempt tenant does not match session tenant', {
      stateTenant: attempt.tenantId,
      sessionTenant: sessionUser.tenant
    });
    return createRedirect(FAILURE_PATH, { xero_error: 'tenant_mismatch' });
  }

  if (!sessionUser.user_id || sessionUser.user_id !== attempt.userId) {
    logger.warn('[xeroOAuth] Attempt user does not match session user', {
      tenantId: sessionUser.tenant
    });
    return createRedirect(FAILURE_PATH, { xero_error: 'user_mismatch' });
  }

  const secretProvider = await getSecretProviderInstance();
  const redirectUri = await getXeroRedirectUri(secretProvider);
  if (attempt.redirectUri !== redirectUri) {
    logger.warn('[xeroOAuth] Attempt redirect does not match current redirect URI', {
      tenantId: sessionUser.tenant
    });
    return createRedirect(FAILURE_PATH, { xero_error: 'redirect_mismatch' });
  }

  const canManageBilling = await hasPermission(sessionUser as any, 'billing_settings', 'update');
  if (!canManageBilling) {
    logger.warn('[xeroOAuth] Callback user no longer has billing settings permission', {
      tenantId: sessionUser.tenant
    });
    return createRedirect(FAILURE_PATH, { xero_error: 'forbidden' });
  }

  const tenantId = attempt.tenantId;

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
    const verifier = await decryptXeroVerifier(attempt.verifier);

    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: String(credentials.clientId),
      client_secret: String(credentials.clientSecret),
      code_verifier: verifier
    });

    const tokenResponse = await axios.post(
      XERO_TOKEN_URL,
      tokenParams.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );

    const tokenData = tokenResponse.data ?? {};
    const accessToken: string | undefined = tokenData.access_token;
    const refreshToken: string | undefined = tokenData.refresh_token;
    if (!accessToken || !refreshToken) {
      logger.error('[xeroOAuth] Token response missing access or refresh token', { tenantId });
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

    const connectionsResponse = await axios.get(XERO_CONNECTIONS_URL, {
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
      logger.error('[xeroOAuth] No Xero connections returned for tenant', { tenantId });
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
      logger.error('[xeroOAuth] Unable to map Xero connections for tenant', { tenantId });
      return createRedirect(FAILURE_PATH, { xero_error: 'connections_unmapped' });
    }

    await upsertStoredXeroConnections(tenantId, connectionUpdates, {
      prioritize: Object.keys(connectionUpdates)
    });

    logger.info('[xeroOAuth] Completed Xero OAuth callback', {
      tenantId,
      credentialSource: credentials.source,
      connectionCount: Object.keys(connectionUpdates).length,
      defaultConnectionId: Object.keys(connectionUpdates)[0]
    });

    return createRedirect(SUCCESS_PATH);
  } catch (error) {
    logger.error('[xeroOAuth] Failed to complete Xero OAuth callback', {
      tenantId,
      errorCode: axios.isAxiosError(error)
        ? `status_${String(error.response?.status ?? 'unknown')}`
        : 'unknown_error'
    });
    return createRedirect(FAILURE_PATH, { xero_error: 'oauth_failed' });
  }
}
