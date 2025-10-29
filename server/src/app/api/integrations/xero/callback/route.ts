export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import axios from 'axios';

import { getSecretProviderInstance } from '@alga-psa/shared/core/secretProvider';

import {
  XERO_CLIENT_ID_SECRET_NAME,
  XERO_CLIENT_SECRET_SECRET_NAME,
  XeroConnectionsStore,
  upsertStoredXeroConnections,
  XERO_TOKEN_URL
} from 'server/src/lib/xero/xeroClientService';

const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';
const XERO_REDIRECT_URI =
  process.env.XERO_REDIRECT_URI ?? 'http://localhost:3000/api/integrations/xero/callback';
const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections';

const SUCCESS_PATH = '/msp/settings?tab=integrations&xero_status=success';
const FAILURE_PATH = '/msp/settings?tab=integrations&xero_status=failure';

type XeroStatePayload = {
  tenantId: string;
  csrf: string;
  codeVerifier: string;
};

function createRedirect(path: string, params?: Record<string, string | undefined>) {
  const url = new URL(path, APP_BASE_URL);
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
  const clientId = await secretProvider.getAppSecret(XERO_CLIENT_ID_SECRET_NAME);
  const clientSecret = await secretProvider.getAppSecret(XERO_CLIENT_SECRET_SECRET_NAME);

  if (!clientId || !clientSecret) {
    return createRedirect(FAILURE_PATH, { xero_error: 'config_missing' });
  }

  try {
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: XERO_REDIRECT_URI,
      client_id: String(clientId),
      client_secret: String(clientSecret),
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

    const connections: Array<{ id?: string; tenantId?: string }> = Array.isArray(
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

    return createRedirect(SUCCESS_PATH);
  } catch (error) {
    console.error('[xeroOAuth] failed to complete OAuth callback for tenant', tenantId, error);
    return createRedirect(FAILURE_PATH, { xero_error: 'oauth_failed' });
  }
}
