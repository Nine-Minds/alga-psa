import axios from 'axios';
import { NextRequest, NextResponse } from 'next/server';
import { createTenantKnex, runWithTenant } from '@/lib/db';
import { resolveMicrosoftCredentialsForTenant } from '@/lib/integrations/entra/auth/microsoftCredentialResolver';
import { saveEntraDirectTokenSet } from '@/lib/integrations/entra/auth/tokenStore';

export const dynamic = 'force-dynamic';

type EntraDirectConnectState = {
  tenant: string;
  userId: string;
  nonce: string;
  timestamp: number;
  redirectUri: string;
  provider: 'microsoft';
  integration: 'entra';
  connectionType: 'direct';
};

function decodeState(state: string): EntraDirectConnectState | null {
  try {
    const parsed = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
    if (!parsed || parsed.integration !== 'entra' || parsed.connectionType !== 'direct') {
      return null;
    }
    return parsed as EntraDirectConnectState;
  } catch {
    return null;
  }
}

function failureRedirect(errorCode: string, message?: string): NextResponse {
  const url = new URL('/msp/settings', process.env.NEXTAUTH_URL || 'http://localhost:3000');
  url.searchParams.set('tab', 'integrations');
  url.searchParams.set('category', 'identity');
  url.searchParams.set('entra_status', 'failure');
  url.searchParams.set('error', errorCode);
  if (message) {
    url.searchParams.set('message', message);
  }
  return NextResponse.redirect(url);
}

function successRedirect(): NextResponse {
  const url = new URL('/msp/settings', process.env.NEXTAUTH_URL || 'http://localhost:3000');
  url.searchParams.set('tab', 'integrations');
  url.searchParams.set('category', 'identity');
  url.searchParams.set('entra_status', 'success');
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const stateRaw = request.nextUrl.searchParams.get('state');
  const oauthError = request.nextUrl.searchParams.get('error');
  const oauthErrorDescription = request.nextUrl.searchParams.get('error_description');

  if (oauthError) {
    return failureRedirect(oauthError, oauthErrorDescription || undefined);
  }

  if (!code || !stateRaw) {
    return failureRedirect('missing_params', 'Missing required OAuth callback parameters.');
  }

  const state = decodeState(stateRaw);
  if (!state?.tenant || !state?.userId || !state?.redirectUri) {
    return failureRedirect('invalid_state', 'OAuth state payload is invalid.');
  }

  if (Date.now() - state.timestamp > 10 * 60 * 1000) {
    return failureRedirect('expired_state', 'OAuth state has expired.');
  }

  const credentials = await resolveMicrosoftCredentialsForTenant(state.tenant);
  if (!credentials) {
    return failureRedirect('missing_credentials', 'Microsoft OAuth credentials are not configured.');
  }

  try {
    const tokenParams = new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: state.redirectUri,
      scope: 'https://graph.microsoft.com/User.Read offline_access',
    });

    const tokenResponse = await axios.post(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      tokenParams.toString(),
      {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      }
    );

    const accessToken = tokenResponse.data?.access_token as string | undefined;
    const refreshToken = tokenResponse.data?.refresh_token as string | undefined;
    const expiresIn = tokenResponse.data?.expires_in as number | undefined;
    const scope = tokenResponse.data?.scope as string | undefined;

    if (!accessToken || !refreshToken || !expiresIn) {
      return failureRedirect('token_exchange_failed', 'Token exchange response missing required fields.');
    }

    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    await saveEntraDirectTokenSet(state.tenant, {
      accessToken,
      refreshToken,
      expiresAt,
      scope: scope || null,
    });

    await runWithTenant(state.tenant, async () => {
      const { knex } = await createTenantKnex();
      const now = knex.fn.now();

      await knex('entra_partner_connections')
        .where({ tenant: state.tenant, is_active: true })
        .update({
          is_active: false,
          status: 'disconnected',
          disconnected_at: now,
          updated_at: now,
        });

      await knex('entra_partner_connections').insert({
        tenant: state.tenant,
        connection_type: 'direct',
        status: 'connected',
        is_active: true,
        token_secret_ref: 'entra_direct',
        connected_at: now,
        disconnected_at: null,
        last_validated_at: now,
        last_validation_error: knex.raw(`'{}'::jsonb`),
        created_by: state.userId,
        updated_by: state.userId,
        created_at: now,
        updated_at: now,
      });
    });

    return successRedirect();
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Failed to complete Microsoft Entra OAuth callback.';
    return failureRedirect('callback_error', message);
  }
}
