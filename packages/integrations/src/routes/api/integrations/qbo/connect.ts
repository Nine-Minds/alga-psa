export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import logger from '@alga-psa/core/logger';

import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { createTenantKnex } from '@alga-psa/db';

import {
  getQboOAuthScopesString,
  getQboRedirectUri,
  resolveQboOAuthCredentials
} from '../../../../lib/qbo/qboClientService';
import {
  getProviderDisconnectStatusInfo,
  isProviderDisconnectActive,
  PROVIDER_QBO,
  withProviderCredentialLock
} from '../../../../lib/providerDisconnect';
import {
  buildQboOAuthStateCookie,
  createQboOAuthState,
  getQboStateSigningSecret
} from '../../../../lib/qbo/qboOAuthState';
import {
  canManageAccountingConnections,
  getAccountingConnectionSessionUser
} from '../../../../lib/accountingConnectionAuth';
import { storeAccountingOAuthNonce } from '../../../../lib/accountingOAuthStateStore';

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

  const disconnectActive = await isProviderDisconnectActive(knex, tenant, PROVIDER_QBO).catch(() => false);
  if (disconnectActive) {
    logger.info('[qboOAuth] Connect blocked: QuickBooks disconnect in progress', { tenantId: tenant });
    return NextResponse.json(
      { error: 'QuickBooks is being disconnected. Finish or finalize the disconnect before connecting again.' },
      { status: 409 }
    );
  }

  const secretProvider = await getSecretProviderInstance();
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

    const oauthState = await withProviderCredentialLock(knex, tenant, PROVIDER_QBO, async (trx) => {
      const active = await isProviderDisconnectActive(trx, tenant, PROVIDER_QBO).catch(() => true);
      if (active) return null;
      const status = await getProviderDisconnectStatusInfo(trx, tenant, PROVIDER_QBO);
      const finalizedAtMs = status?.finalizedAt ? Date.parse(status.finalizedAt) : Number.NaN;
      const initiatedAt = new Date(
        Number.isFinite(finalizedAtMs) ? Math.max(Date.now(), finalizedAtMs + 1) : Date.now()
      ).toISOString();
      const created = createQboOAuthState({
        tenantId: tenant,
        userId: sessionUser.user_id,
        secret: signingSecret,
        initiatedAt
      });
      await storeAccountingOAuthNonce('qbo', created.payload.nonce, {
        tenantId: tenant,
        initiatedAt
      });
      return created;
    });
    if (!oauthState) {
      return NextResponse.json(
        { error: 'QuickBooks is being disconnected. Finish or finalize the disconnect before connecting again.' },
        { status: 409 }
      );
    }
    const { stateParam, cookieValue } = oauthState;

    logger.info('[qboOAuth] Starting QuickBooks OAuth connect flow', {
      tenantId: tenant,
      userId: sessionUser.user_id,
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
    return NextResponse.json(
      { error: 'QuickBooks connection is not configured for this workspace.' },
      { status: 400 }
    );
  }
}
