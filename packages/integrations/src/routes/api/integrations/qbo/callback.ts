export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import axios from 'axios';
import logger from '@alga-psa/core/logger';

import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { createTenantKnex, writeAccountingAudit } from '@alga-psa/db';

import {
  getQboRedirectUri,
  resolveQboOAuthCredentials,
  upsertStoredQboCredentials,
  QBO_TOKEN_URL
} from '../../../../lib/qbo/qboClientService';
import {
  buildClearedQboOAuthStateCookie,
  getQboStateSigningSecret,
  QBO_OAUTH_STATE_COOKIE,
  validateQboOAuthState
} from '../../../../lib/qbo/qboOAuthState';
import {
  authorizeAccountingOAuthCallback,
  reauthorizeAccountingOAuthCallback,
  revokeAccountingOAuthGrant,
  type AccountingOAuthAuthzErrorCode
} from '../../../../lib/accountingConnectionAuth';
import { consumeAccountingOAuthNonce } from '../../../../lib/accountingOAuthStateStore';

const NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';

const SUCCESS_PATH =
  '/msp/settings?tab=integrations&category=accounting&accounting_integration=qbo&qbo_status=success';
const FAILURE_PATH =
  '/msp/settings?tab=integrations&category=accounting&accounting_integration=qbo&qbo_status=failure';

// Neutral, actionable callback error params surfaced in the settings UI. They
// never include provider-side org/company details.
const AUTHZ_ERROR_TO_PARAM: Record<AccountingOAuthAuthzErrorCode, string> = {
  STATE_REPLAYED: 'state_replayed',
  AUTH_REQUIRED: 'session_expired',
  USER_MISMATCH: 'user_mismatch',
  TENANT_MISMATCH: 'tenant_mismatch',
  FORBIDDEN: 'forbidden'
};

function isEnterpriseEdition(): boolean {
  return (
    (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
    (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise'
  );
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) {
    return undefined;
  }

  for (const part of header.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName === name) {
      return decodeURIComponent(rawValue.join('='));
    }
  }
  return undefined;
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
  response.cookies.set(buildClearedQboOAuthStateCookie());
  return response;
}

// A provider-side denial (error param) still leaves no reusable state: burn the
// state nonce when a valid state is present, best-effort.
async function burnQboOAuthStateIfPresent(request: Request): Promise<void> {
  try {
    const signingSecret = await getQboStateSigningSecret();
    const statePayload = validateQboOAuthState({
      stateParam: new URL(request.url).searchParams.get('state'),
      cookieValue: readCookie(request, QBO_OAUTH_STATE_COOKIE),
      secret: signingSecret ?? undefined
    });
    if (statePayload) {
      await consumeAccountingOAuthNonce('qbo', statePayload.nonce);
    }
  } catch {
    // Best-effort only: denial redirects must never fail because a burn did.
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!isEnterpriseEdition()) {
    return NextResponse.json(
      { error: 'QuickBooks Online integration is only available in Enterprise Edition.' },
      { status: 501 }
    );
  }

  const { searchParams } = new URL(request.url);
  const errorParam = searchParams.get('error');
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const realmId = searchParams.get('realmId');

  if (errorParam) {
    await burnQboOAuthStateIfPresent(request);
    return createRedirect(FAILURE_PATH, { qbo_error: errorParam });
  }

  if (!code || !state || !realmId) {
    return createRedirect(FAILURE_PATH, { qbo_error: 'missing_params' });
  }

  const signingSecret = await getQboStateSigningSecret();
  const statePayload = validateQboOAuthState({
    stateParam: state,
    cookieValue: readCookie(request, QBO_OAUTH_STATE_COOKIE),
    secret: signingSecret ?? undefined
  });

  if (!statePayload) {
    logger.warn('[qboOAuth] OAuth state validation failed on callback');
    return createRedirect(FAILURE_PATH, { qbo_error: 'invalid_state' });
  }

  // Re-authorize the current live user before exchanging the code: the state is
  // atomically consumed here, and the callback proceeds only if the live user
  // is still the initiating user in the initiating tenant with the
  // connection-admin permission.
  const authz = await authorizeAccountingOAuthCallback({
    provider: 'qbo',
    tenantId: statePayload.tenantId,
    userId: statePayload.userId,
    nonce: statePayload.nonce
  });
  if (!authz.ok) {
    logger.warn('[qboOAuth] Callback authorization failed', {
      tenantId: statePayload.tenantId,
      code: authz.code
    });
    return createRedirect(FAILURE_PATH, { qbo_error: AUTHZ_ERROR_TO_PARAM[authz.code] });
  }

  const tenantId = statePayload.tenantId;
  const secretProvider = await getSecretProviderInstance();
  const redirectUri = await getQboRedirectUri(secretProvider);

  let credentials;
  try {
    credentials = await resolveQboOAuthCredentials(tenantId, secretProvider);
  } catch (error) {
    logger.warn('[qboOAuth] Callback received without usable credentials', {
      tenantId,
      error: error instanceof Error ? error.message : error
    });
    return createRedirect(FAILURE_PATH, { qbo_error: 'config_missing' });
  }

  try {
    const authHeader = `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64')}`;
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri
    });

    const tokenResponse = await axios.post(QBO_TOKEN_URL, tokenParams.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        Authorization: authHeader
      },
      timeout: 15000
    });

    const tokenData = tokenResponse.data ?? {};
    const accessToken: string | undefined = tokenData.access_token;
    const refreshToken: string | undefined = tokenData.refresh_token;
    if (!accessToken || !refreshToken) {
      logger.error('[qboOAuth] Token response missing access or refresh token', { tenantId });
      return createRedirect(FAILURE_PATH, { qbo_error: 'token_exchange_failed' });
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
        provider: 'qbo',
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        refreshToken
      });
      logger.warn('[qboOAuth] Persistence-time authorization failed; grant revoked', {
        tenantId,
        code: reauthz.code
      });
      return createRedirect(FAILURE_PATH, { qbo_error: AUTHZ_ERROR_TO_PARAM[reauthz.code] });
    }

    const expiresInSeconds =
      typeof tokenData.expires_in === 'number' ? tokenData.expires_in : 3600;
    const refreshExpiresInSeconds =
      typeof tokenData.x_refresh_token_expires_in === 'number'
        ? tokenData.x_refresh_token_expires_in
        : 60 * 60 * 24 * 100;
    const now = Date.now();

    await upsertStoredQboCredentials(tenantId, {
      accessToken,
      refreshToken,
      realmId,
      accessTokenExpiresAt: new Date(now + expiresInSeconds * 1000).toISOString(),
      refreshTokenExpiresAt: new Date(now + refreshExpiresInSeconds * 1000).toISOString()
    });

    logger.info('[qboOAuth] Completed QuickBooks OAuth callback', {
      tenantId,
      realmId,
      credentialSource: credentials.source
    });

    // Audit the connection lifecycle event (no secrets recorded). The actor is
    // the re-verified initiating user carried on the OAuth state. Auditing is
    // strictly best-effort: a failure while recording the audit entry must
    // never turn a completed connection into a failed one, so the whole block
    // — including obtaining the knex handle — is guarded.
    try {
      const { knex: auditKnex } = await createTenantKnex();
      await writeAccountingAudit(auditKnex, tenantId, 'accounting_connected', {
        userId: statePayload.userId,
        provider: 'qbo',
        recordId: realmId,
        details: { realmId },
      });
    } catch (error) {
      logger.warn('[qboOAuth] Failed to write connect audit entry', { tenantId, error });
    }

    return createRedirect(SUCCESS_PATH);
  } catch (error) {
    logger.error('[qboOAuth] Failed to complete OAuth callback', {
      tenantId,
      error: error instanceof Error ? error.message : 'unknown_error'
    });
    return createRedirect(FAILURE_PATH, { qbo_error: 'oauth_failed' });
  }
}
