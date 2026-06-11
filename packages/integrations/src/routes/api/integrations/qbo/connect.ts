export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import logger from '@alga-psa/core/logger';

import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { getSession } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';

import { createTenantKnex } from '@alga-psa/db';
import {
  getQboOAuthScopesString,
  getQboRedirectUri,
  resolveQboOAuthCredentials
} from '../../../../lib/qbo/qboClientService';
import {
  buildQboOAuthStateCookie,
  createQboOAuthState,
  getQboStateSigningSecret
} from '../../../../lib/qbo/qboOAuthState';

const INTUIT_AUTHORIZE_URL =
  process.env.QBO_OAUTH_AUTHORIZE_URL ?? 'https://appcenter.intuit.com/connect/oauth2';

function isEnterpriseEdition(): boolean {
  return (
    (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
    (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise'
  );
}

export async function GET(): Promise<NextResponse> {
  if (!isEnterpriseEdition()) {
    return NextResponse.json(
      { error: 'QuickBooks Online integration is only available in Enterprise Edition.' },
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

  const redirectUri = await getQboRedirectUri(secretProvider);

  try {
    const credentials = await resolveQboOAuthCredentials(tenant, secretProvider);

    const signingSecret = await getQboStateSigningSecret();
    if (!signingSecret) {
      logger.error('[qboOAuth] NEXTAUTH_SECRET is not configured; cannot sign OAuth state');
      return NextResponse.json(
        { error: 'QuickBooks integration is not configured correctly on this deployment.' },
        { status: 500 }
      );
    }

    const { stateParam, cookieValue } = createQboOAuthState({
      tenantId: tenant,
      secret: signingSecret
    });

    logger.info('[qboOAuth] Starting QuickBooks OAuth connect flow', {
      tenantId: tenant,
      credentialSource: credentials.source
    });

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: String(credentials.clientId),
      redirect_uri: redirectUri,
      scope: getQboOAuthScopesString(),
      state: stateParam
    });

    const authorizeUrl = `${INTUIT_AUTHORIZE_URL}?${params.toString()}`;
    const response = NextResponse.redirect(authorizeUrl);
    response.cookies.set(buildQboOAuthStateCookie(cookieValue));
    return response;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'QuickBooks client credentials are not configured for this tenant.';
    logger.warn('[qboOAuth] Unable to start QuickBooks OAuth connect flow', {
      tenantId: tenant,
      error: message
    });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
