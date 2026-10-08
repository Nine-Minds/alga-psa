export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import logger from '@alga-psa/core/logger';

import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { createTenantKnex } from '@alga-psa/db';

import {
  getXeroOAuthScopeConfig,
  getXeroRedirectUri,
  resolveXeroOAuthCredentials
} from '../../../../lib/xero/xeroClientService';
import {
  getProviderDisconnectStatusInfo,
  isProviderDisconnectActive,
  PROVIDER_XERO,
  withProviderCredentialLock
} from '../../../../lib/providerDisconnect';
import { generateOauthCsrfToken, buildOauthCsrfCookieOptions } from '../../../../lib/oauth/oauthCsrf';
import { XERO_OAUTH_CSRF_COOKIE } from '../../../../lib/xero/oauthCsrf';
import {
  canManageAccountingConnections,
  getAccountingConnectionSessionUser
} from '../../../../lib/accountingConnectionAuth';
import {
  XERO_CONNECT_ATTEMPT_PROVIDER,
  XERO_CONNECT_ATTEMPT_TTL_SECONDS,
  storeXeroConnectAttempt
} from '../../../../lib/xero/xeroOAuthConnectAttemptStore';
import { encryptXeroVerifier } from '../../../../lib/xero/xeroOAuthVerifierCipher';

const XERO_AUTHORIZE_URL =
  process.env.XERO_OAUTH_AUTHORIZE_URL ?? 'https://login.xero.com/identity/connect/authorize';

const NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';

const FAILURE_PATH =
  '/msp/settings?tab=integrations&category=accounting&accounting_integration=xero&xero_status=failure';

// The Connect button navigates the browser here, so a JSON error body would
// replace the settings page with raw text. Browser navigations (Accept:
// text/html) go back to the settings page with a coarse xero_error code the
// panel renders; API callers keep the JSON contract.
function connectFailure(
  request: NextRequest,
  code: string,
  message: string,
  status: number
): NextResponse {
  if (request.headers.get('accept')?.includes('text/html')) {
    const url = new URL(FAILURE_PATH, NEXTAUTH_URL);
    url.searchParams.set('xero_error', code);
    return NextResponse.redirect(url);
  }
  return NextResponse.json({ error: message }, { status });
}

const CSRF_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

function isEnterpriseEdition(): boolean {
  return (
    (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
    (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise'
  );
}

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = toBase64Url(crypto.randomBytes(64));
  const challenge = toBase64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    return await handleConnectRequest(request);
  } catch (error) {
    logger.error('[xeroOAuth] Unexpected failure while starting Xero OAuth', {
      errorCode: error instanceof Error ? error.constructor.name : 'unknown_error'
    });
    return connectFailure(
      request,
      'oauth_failed',
      'Unable to start the Xero connection. Please refresh and try again.',
      503
    );
  }
}

async function handleConnectRequest(request: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) {
    return connectFailure(request, 'oauth_failed', 'Xero integration is only available in Enterprise Edition.', 501);
  }

  const sessionUser = await getAccountingConnectionSessionUser();
  if (!sessionUser) {
    return connectFailure(request, 'session_expired', 'Authentication required.', 401);
  }
  const canManageBilling = await canManageAccountingConnections(sessionUser);
  if (!canManageBilling) {
    return connectFailure(request, 'forbidden', 'Forbidden', 403);
  }
  const { knex, tenant } = await createTenantKnex(sessionUser.tenant);

  if (!tenant) {
    return connectFailure(request, 'session_expired', 'Authentication required.', 401);
  }

  const disconnectActive = await isProviderDisconnectActive(knex, tenant, PROVIDER_XERO).catch(() => false);
  if (disconnectActive) {
    logger.info('[xeroOAuth] Connect blocked: Xero disconnect in progress', { tenantId: tenant });
    return connectFailure(
      request,
      'disconnect_in_progress',
      'Xero is being disconnected. Finish or finalize the disconnect before connecting again.',
      409
    );
  }

  const secretProvider = await getSecretProviderInstance();
  const redirectUri = await getXeroRedirectUri(secretProvider);

  try {
    const credentials = await resolveXeroOAuthCredentials(tenant, secretProvider);
    const scopeConfig = getXeroOAuthScopeConfig();
    const oauthState = await withProviderCredentialLock(knex, tenant, PROVIDER_XERO, async (trx) => {
      const active = await isProviderDisconnectActive(trx, tenant, PROVIDER_XERO).catch(() => true);
      if (active) return null;
      const status = await getProviderDisconnectStatusInfo(trx, tenant, PROVIDER_XERO);
      const finalizedAtMs = status?.finalizedAt ? Date.parse(status.finalizedAt) : Number.NaN;
      const createdAt = Number.isFinite(finalizedAtMs)
        ? Math.max(Date.now(), finalizedAtMs + 1)
        : Date.now();
      // The CSRF cookie is a single browser-slot value. Reuse an existing
      // well-formed token so parallel attempts remain bound to the same cookie.
      const existingCsrf = request.cookies.get(XERO_OAUTH_CSRF_COOKIE.name)?.value;
      const csrfToken =
        existingCsrf && CSRF_TOKEN_PATTERN.test(existingCsrf) ? existingCsrf : generateOauthCsrfToken();
      const { verifier, challenge } = createPkcePair();
      const nonce = crypto.randomBytes(32).toString('base64url');
      const encryptedVerifier = await encryptXeroVerifier(verifier);
      await storeXeroConnectAttempt(
        nonce,
        {
          verifier: encryptedVerifier,
          tenantId: tenant,
          userId: sessionUser.user_id,
          provider: XERO_CONNECT_ATTEMPT_PROVIDER,
          redirectUri,
          csrf: csrfToken,
          createdAt,
          expiresAt: createdAt + XERO_CONNECT_ATTEMPT_TTL_SECONDS * 1000
        },
        XERO_CONNECT_ATTEMPT_TTL_SECONDS
      );
      return {
        csrfToken,
        challenge,
        state: nonce
      };
    });
    if (!oauthState) {
      return connectFailure(
        request,
        'disconnect_in_progress',
        'Xero is being disconnected. Finish or finalize the disconnect before connecting again.',
        409
      );
    }
    const { csrfToken, challenge, state } = oauthState;

    logger.info('[xeroOAuth] Starting Xero OAuth connect flow', {
      tenantId: tenant,
      userId: sessionUser.user_id,
      credentialSource: credentials.source,
      scopeSource: scopeConfig.source,
      scopes: scopeConfig.scopes
    });

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: String(credentials.clientId),
      redirect_uri: redirectUri,
      scope: scopeConfig.scopes.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256'
    });

    const authorizeUrl = `${XERO_AUTHORIZE_URL}?${params.toString()}`;
    // Carry the CSRF token in an HttpOnly cookie shared by the connect and
    // callback routes so the callback can confirm the response landed in the
    // same browser that started the flow. The token is also bound to the
    // server-side attempt record, so a forged callback that knows the state
    // nonce still fails.
    const response = NextResponse.redirect(authorizeUrl);
    response.cookies.set(
      XERO_OAUTH_CSRF_COOKIE.name,
      csrfToken,
      buildOauthCsrfCookieOptions(XERO_OAUTH_CSRF_COOKIE)
    );
    return response;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Xero client credentials are not configured for this tenant.';
    logger.warn('[xeroOAuth] Unable to start Xero OAuth connect flow', {
      tenantId: tenant,
      error: message
    });
    return connectFailure(
      request,
      'config_missing',
      'Xero connection is not configured for this workspace.',
      400
    );
  }
}
