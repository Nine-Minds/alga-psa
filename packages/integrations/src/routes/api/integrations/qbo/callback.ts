export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import axios from 'axios';
import logger from '@alga-psa/core/logger';

import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { getSession } from '@alga-psa/auth';

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

const NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';

const SUCCESS_PATH =
  '/msp/settings?tab=integrations&category=accounting&accounting_integration=qbo&qbo_status=success';
const FAILURE_PATH =
  '/msp/settings?tab=integrations&category=accounting&accounting_integration=qbo&qbo_status=failure';

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

  // Defense in depth on top of the signed state cookie: the callback must be
  // completed by an authenticated session belonging to the same tenant that
  // started the flow (mirrors the session-tenant binding added on main).
  const session = await getSession();
  const sessionTenant = (session?.user as { tenant?: string } | undefined)?.tenant;
  if (!sessionTenant) {
    logger.warn('[qboOAuth] Callback received without an authenticated session');
    return createRedirect(FAILURE_PATH, { qbo_error: 'session_expired' });
  }
  if (sessionTenant !== statePayload.tenantId) {
    logger.warn('[qboOAuth] Callback state tenant does not match session tenant', {
      stateTenant: statePayload.tenantId,
      sessionTenant
    });
    return createRedirect(FAILURE_PATH, { qbo_error: 'tenant_mismatch' });
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

    return createRedirect(SUCCESS_PATH);
  } catch (error) {
    logger.error('[qboOAuth] Failed to complete OAuth callback', {
      tenantId,
      error: error instanceof Error ? error.message : 'unknown_error'
    });
    return createRedirect(FAILURE_PATH, { qbo_error: 'oauth_failed' });
  }
}
