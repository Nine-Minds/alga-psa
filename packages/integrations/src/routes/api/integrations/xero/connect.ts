export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import logger from '@alga-psa/core/logger';

import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { getSession } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';

import { createTenantKnex } from '@alga-psa/db';
import {
  getXeroOAuthScopesString,
  getXeroRedirectUri,
  resolveXeroOAuthCredentials
} from '../../../../lib/xero/xeroClientService';
import { generateOauthCsrfToken, buildOauthCsrfCookieOptions } from '../../../../lib/oauth/oauthCsrf';
import { XERO_OAUTH_CSRF_COOKIE } from '../../../../lib/xero/oauthCsrf';
import {
  XERO_CONNECT_ATTEMPT_PROVIDER,
  XERO_CONNECT_ATTEMPT_TTL_SECONDS,
  storeXeroConnectAttempt
} from '../../../../lib/xero/xeroOAuthConnectAttemptStore';
import { encryptXeroVerifier } from '../../../../lib/xero/xeroOAuthVerifierCipher';

const XERO_AUTHORIZE_URL =
  process.env.XERO_OAUTH_AUTHORIZE_URL ?? 'https://login.xero.com/identity/connect/authorize';

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
    return NextResponse.json(
      { error: 'Unable to start the Xero connection. Please refresh and try again.' },
      { status: 503 }
    );
  }
}

async function handleConnectRequest(request: NextRequest): Promise<NextResponse> {
  if (!isEnterpriseEdition()) {
    return NextResponse.json(
      { error: 'Xero integration is only available in Enterprise Edition.' },
      { status: 501 }
    );
  }

  const secretProvider = await getSecretProviderInstance();
  const session = await getSession();
  const sessionUser = session?.user as any;
  const permissionUser =
    sessionUser && !sessionUser.user_id && sessionUser.id
      ? { ...sessionUser, user_id: sessionUser.id }
      : sessionUser;
  const sessionTenant = sessionUser?.tenant;
  if (!sessionTenant) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  const canManageBilling = await hasPermission(permissionUser, 'billing_settings', 'update');
  if (!canManageBilling) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { tenant } = await createTenantKnex(sessionTenant);

  if (!tenant) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const redirectUri = await getXeroRedirectUri(secretProvider);

  try {
    const credentials = await resolveXeroOAuthCredentials(tenant, secretProvider);
    // The CSRF cookie is a single browser-slot value. Reuse an existing
    // well-formed token so a second parallel attempt in the same browser does
    // not clobber the first: both attempts bind to the same cookie value and
    // each callback still passes the double-submit check.
    const existingCsrf = request.cookies.get(XERO_OAUTH_CSRF_COOKIE.name)?.value;
    const csrfToken =
      existingCsrf && CSRF_TOKEN_PATTERN.test(existingCsrf) ? existingCsrf : generateOauthCsrfToken();
    const { verifier, challenge } = createPkcePair();

    // The public state is an opaque 256-bit nonce. The PKCE verifier and every
    // binding live in a short-lived, single-use server-side record keyed by the
    // nonce; nothing confidential is sent through the browser.
    const nonce = crypto.randomBytes(32).toString('base64url');
    const encryptedVerifier = await encryptXeroVerifier(verifier);
    await storeXeroConnectAttempt(
      nonce,
      {
        verifier: encryptedVerifier,
        tenantId: tenant,
        userId: permissionUser?.user_id,
        provider: XERO_CONNECT_ATTEMPT_PROVIDER,
        redirectUri,
        csrf: csrfToken,
        createdAt: Date.now(),
        expiresAt: Date.now() + XERO_CONNECT_ATTEMPT_TTL_SECONDS * 1000
      },
      XERO_CONNECT_ATTEMPT_TTL_SECONDS
    );

    logger.info('[xeroOAuth] Starting Xero OAuth connect flow', {
      tenantId: tenant,
      credentialSource: credentials.source
    });

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: String(credentials.clientId),
      redirect_uri: redirectUri,
      scope: getXeroOAuthScopesString(),
      state: nonce,
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
    return NextResponse.json(
      { error: 'Xero connection is not configured for this workspace.' },
      { status: 400 }
    );
  }
}
