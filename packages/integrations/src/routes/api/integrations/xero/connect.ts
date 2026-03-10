export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
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
    const csrfToken = toBase64Url(crypto.randomBytes(24));
    const { verifier, challenge } = createPkcePair();
    const statePayload = {
      tenantId: tenant,
      csrf: csrfToken,
      codeVerifier: verifier
    };
    const state = Buffer.from(JSON.stringify(statePayload)).toString('base64url');

    logger.info('[xeroOAuth] Starting Xero OAuth connect flow', {
      tenantId: tenant,
      credentialSource: credentials.source
    });

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: String(credentials.clientId),
      redirect_uri: redirectUri,
      scope: getXeroOAuthScopesString(),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256'
    });

    const authorizeUrl = `${XERO_AUTHORIZE_URL}?${params.toString()}`;
    return NextResponse.redirect(authorizeUrl);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Xero client credentials are not configured for this tenant.';
    logger.warn('[xeroOAuth] Unable to start Xero OAuth connect flow', {
      tenantId: tenant,
      error: message
    });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
