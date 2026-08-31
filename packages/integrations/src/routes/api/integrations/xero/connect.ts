export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
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
import { storeAccountingOAuthNonce } from '../../../../lib/accountingOAuthStateStore';

const XERO_AUTHORIZE_URL =
  process.env.XERO_OAUTH_AUTHORIZE_URL ?? 'https://login.xero.com/identity/connect/authorize';

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

export async function GET(): Promise<NextResponse> {
  try {
    return await handleConnectRequest();
  } catch (error) {
    logger.error('[xeroOAuth] Unexpected failure while starting Xero OAuth', { error });
    return NextResponse.json(
      { error: 'Unable to start the Xero connection. Please refresh and try again.' },
      { status: 503 }
    );
  }
}

async function handleConnectRequest(): Promise<NextResponse> {
  if (!isEnterpriseEdition()) {
    return NextResponse.json(
      { error: 'Xero integration is only available in Enterprise Edition.' },
      { status: 501 }
    );
  }

  const sessionUser = await getAccountingConnectionSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  const canManageBilling = await canManageAccountingConnections(sessionUser);
  if (!canManageBilling) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { knex, tenant } = await createTenantKnex(sessionUser.tenant);

  if (!tenant) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const disconnectActive = await isProviderDisconnectActive(knex, tenant, PROVIDER_XERO).catch(() => false);
  if (disconnectActive) {
    logger.info('[xeroOAuth] Connect blocked: Xero disconnect in progress', { tenantId: tenant });
    return NextResponse.json(
      { error: 'Xero is being disconnected. Finish or finalize the disconnect before connecting again.' },
      { status: 409 }
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
      const initiatedAt = new Date(
        Number.isFinite(finalizedAtMs) ? Math.max(Date.now(), finalizedAtMs + 1) : Date.now()
      ).toISOString();
      const csrfToken = generateOauthCsrfToken();
      const { verifier, challenge } = createPkcePair();
      const nonce = crypto.randomBytes(12).toString('hex');
      const statePayload = {
        tenantId: tenant,
        userId: sessionUser.user_id,
        csrf: csrfToken,
        codeVerifier: verifier,
        nonce,
        initiatedAt
      };
      await storeAccountingOAuthNonce('xero', nonce, { tenantId: tenant, initiatedAt });
      return {
        csrfToken,
        challenge,
        state: Buffer.from(JSON.stringify(statePayload)).toString('base64url')
      };
    });
    if (!oauthState) {
      return NextResponse.json(
        { error: 'Xero is being disconnected. Finish or finalize the disconnect before connecting again.' },
        { status: 409 }
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
    // Carry the CSRF token in an HttpOnly cookie scoped to the callback route so
    // the callback can confirm the response landed in the same browser that
    // started the flow (the PKCE code_verifier lives in the unsigned state and
    // must not be the only binding).
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
    return NextResponse.json(
      { error: 'Xero connection is not configured for this workspace.' },
      { status: 400 }
    );
  }
}
