import { NextRequest, NextResponse } from 'next/server';
import { decodeState, validateState } from '@/utils/email/oauthHelpers';
import { createTenantKnex } from '@/lib/db';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import axios from 'axios';
import { assertTenantProductAccess } from '@/lib/productAccess';

export async function GET(request: NextRequest) {
  try {
    const url = request.nextUrl;
    const code = url.searchParams.get('code');
    const stateParam = url.searchParams.get('state');

    if (!code || !stateParam) {
      return NextResponse.json({ error: 'Missing code/state' }, { status: 400 });
    }

    const state = decodeState(stateParam);
    if (!state || !validateState(state)) {
      return NextResponse.json({ error: 'Invalid OAuth state' }, { status: 400 });
    }
    await assertTenantProductAccess({
      tenantId: state.tenant,
      capability: 'email_to_ticket',
      allowedProducts: ['psa', 'algadesk'],
    });

    if (!state.providerId) {
      return NextResponse.json({ error: 'Missing providerId' }, { status: 400 });
    }

    const { knex, tenant } = await createTenantKnex();
    if (tenant !== state.tenant) {
      return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
    }

    const provider = await knex('email_providers')
      .where({ id: state.providerId, tenant, provider_type: 'imap' })
      .first();

    if (!provider) {
      return NextResponse.json({ error: 'IMAP provider not found' }, { status: 404 });
    }

    const imapConfig = await knex('imap_email_provider_config')
      .where({ email_provider_id: state.providerId, tenant })
      .first();

    if (!imapConfig) {
      return NextResponse.json({ error: 'IMAP provider config not found' }, { status: 404 });
    }

    if (!imapConfig.oauth_token_url || !imapConfig.oauth_client_id) {
      return NextResponse.json({ error: 'IMAP OAuth token configuration missing' }, { status: 400 });
    }

    const secretProvider = await getSecretProviderInstance();
    const clientSecret = await secretProvider.getTenantSecret(tenant, `imap_oauth_client_secret_${state.providerId}`);

    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', state.redirectUri);
    params.append('client_id', imapConfig.oauth_client_id);
    if (clientSecret) {
      params.append('client_secret', clientSecret);
    }

    const tokenResponse = await axios.post(imapConfig.oauth_token_url, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const accessToken = tokenResponse.data.access_token;
    const refreshToken = tokenResponse.data.refresh_token;
    const expiresIn = Number(tokenResponse.data.expires_in || 3600);
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    if (refreshToken) {
      await secretProvider.setTenantSecret(tenant, `imap_refresh_token_${state.providerId}`, refreshToken);
    }

    await knex('imap_email_provider_config')
      .where({ email_provider_id: state.providerId, tenant })
      .update({
        access_token: accessToken,
        refresh_token: refreshToken || null,
        token_expires_at: expiresAt,
        updated_at: knex.fn.now(),
      });

    await knex('email_providers')
      .where({ id: state.providerId, tenant })
      .update({
        status: 'connected',
        error_message: null,
        updated_at: knex.fn.now(),
      });

    const rawSuccessRedirect = state.redirectUri || url.origin;
    let successRedirect = rawSuccessRedirect;

    // Prevent redirecting back to this callback endpoint, which causes a second
    // request without code/state and surfaces a false "Missing code/state" error.
    try {
      const parsed = new URL(rawSuccessRedirect, url.origin);
      if (parsed.pathname === '/api/email/oauth/imap/callback') {
        parsed.pathname = '/msp/settings/email';
        parsed.searchParams.set('imapOAuth', 'success');
        parsed.searchParams.set('providerId', state.providerId);
        successRedirect = parsed.toString();
      }
    } catch {
      // Keep original redirect target if it cannot be parsed.
    }

    return NextResponse.redirect(successRedirect);
  } catch (error: any) {
    console.error('IMAP OAuth callback error:', error);
    return NextResponse.json({ error: error.message || 'Failed to finalize IMAP OAuth' }, { status: 500 });
  }
}
