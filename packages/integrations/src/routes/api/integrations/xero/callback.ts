export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import axios from 'axios';
import logger from '@alga-psa/core/logger';

import { getSecretProviderInstance } from '@alga-psa/core/secrets';

import {
  getXeroRedirectUri,
  XeroConnectionsStore,
  resolveXeroOAuthCredentials,
  upsertStoredXeroConnections,
  XERO_TOKEN_URL
} from '../../../../lib/xero/xeroClientService';

const NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';
const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections';

const SUCCESS_PATH =
  '/msp/settings?tab=integrations&category=accounting&accounting_integration=xero&xero_status=success';
const FAILURE_PATH =
  '/msp/settings?tab=integrations&category=accounting&accounting_integration=xero&xero_status=failure';

type XeroStatePayload = {
  tenantId: string;
  csrf: string;
  codeVerifier: string;
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
  return NextResponse.redirect(url);
}

export async function GET(request: Request): Promise<NextResponse> {
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
    return createRedirect(FAILURE_PATH, { xero_error: errorParam });
  }

  if (!code || !state) {
    return createRedirect(FAILURE_PATH, { xero_error: 'missing_params' });
  }

  let statePayload: XeroStatePayload;
  try {
    statePayload = JSON.parse(Buffer.from(state, 'base64url').toString('utf-8')) as XeroStatePayload;
    if (!statePayload?.tenantId || !statePayload?.codeVerifier) {
      throw new Error('state missing required fields');
    }
  } catch (error) {
    console.error('[xeroOAuth] failed to decode state', error);
    return createRedirect(FAILURE_PATH, { xero_error: 'invalid_state' });
  }

  const tenantId = statePayload.tenantId;
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
    logger.error('[xeroOAuth] Failed to complete OAuth callback', {
      tenantId,
      error: error instanceof Error ? error.message : 'unknown_error'
    });
    return createRedirect(FAILURE_PATH, { xero_error: 'oauth_failed' });
  }
}
