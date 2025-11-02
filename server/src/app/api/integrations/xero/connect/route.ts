export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import crypto from 'crypto';

import { getSecretProviderInstance } from '@alga-psa/shared/core/secretProvider';

import { createTenantKnex } from 'server/src/lib/db';
import { getXeroClientId } from 'server/src/lib/xero/xeroClientService';

const XERO_AUTHORIZE_URL =
  process.env.XERO_OAUTH_AUTHORIZE_URL ?? 'https://login.xero.com/identity/connect/authorize';
const XERO_REDIRECT_URI = `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/integrations/xero/callback`;
const XERO_SCOPES =
  process.env.XERO_OAUTH_SCOPES ??
  'offline_access accounting.settings accounting.transactions accounting.contacts';

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
  const secretProvider = await getSecretProviderInstance();
  const { tenant } = await createTenantKnex();

  if (!tenant) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }

  const clientId = await getXeroClientId(secretProvider);
  if (!clientId) {
    return NextResponse.json({ error: 'Xero integration not configured.' }, { status: 500 });
  }

  const csrfToken = toBase64Url(crypto.randomBytes(24));
  const { verifier, challenge } = createPkcePair();
  const statePayload = {
    tenantId: tenant,
    csrf: csrfToken,
    codeVerifier: verifier
  };
  const state = Buffer.from(JSON.stringify(statePayload)).toString('base64url');

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: String(clientId),
    redirect_uri: XERO_REDIRECT_URI,
    scope: XERO_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  });

  const authorizeUrl = `${XERO_AUTHORIZE_URL}?${params.toString()}`;
  return NextResponse.redirect(authorizeUrl);
}
