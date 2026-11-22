import { redirectToAppPath } from '@alga-psa/core/redirectToAppPath';
import { NextRequest, NextResponse } from 'next/server';
import { tenantDb } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { verifyImapOAuthState } from '@/utils/email/imapOAuthState';
import { createTenantKnex } from '@/lib/db';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { assertPublicHttpsUrl, postSafeOutboundForm } from '@alga-psa/core/net/safeFetch';
import {
  assertSafeImapOauthTokenEndpoint,
  getImapOauthSecretNames,
} from '@alga-psa/shared/services/email/imapOutboundTarget';
import { getImapOauthAuthorizationCredentials } from '@alga-psa/shared/services/email/imapOauthToken';
import { assertTenantProductAccess, isProductAccessError, toProductAccessDeniedResponse } from '@/lib/productAccess';
import { requireOutboundEmailAdmin } from '@alga-psa/integrations/actions/email-actions/mspOutboundEmailAccess';

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { knex, tenant } = await createTenantKnex();
    if (tenant !== user.tenant) {
      return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
    }
    const access = await requireOutboundEmailAdmin(user, knex);
    if (!access.allowed) {
      return NextResponse.json({ error: access.message }, { status: 403 });
    }

    const url = request.nextUrl;
    const code = url.searchParams.get('code');
    const stateParam = url.searchParams.get('state');

    if (!code || !stateParam) {
      return NextResponse.json({ error: 'Missing code/state' }, { status: 400 });
    }

    const state = await verifyImapOAuthState(stateParam);
    if (!state) {
      return NextResponse.json({ error: 'Invalid OAuth state' }, { status: 400 });
    }
    // State signature authenticates the tenant/provider bindings. Consume the
    // nonce atomically before looking up provider data or retrieving secrets.
    if (state.tenant !== user.tenant || state.userId !== user.user_id || tenant !== state.tenant) {
      return NextResponse.json({ error: 'Tenant mismatch' }, { status: 403 });
    }
    const db = tenantDb(knex, tenant);
    const consumed = await db.table('imap_oauth_states')
      .where({ tenant: state.tenant, nonce: state.nonce })
      .where('expires_at', '>', new Date().toISOString())
      .delete()
      .returning('state');
    const persistedState = consumed?.[0]?.state;
    if (!persistedState || persistedState.purpose !== state.purpose ||
      persistedState.tenant !== state.tenant || persistedState.providerId !== state.providerId ||
      persistedState.userId !== state.userId || persistedState.redirectUri !== state.redirectUri ||
      persistedState.expiresAt !== state.expiresAt) {
      return NextResponse.json({ error: 'OAuth state expired or already used' }, { status: 400 });
    }
    await assertTenantProductAccess({
      tenantId: user.tenant,
      capability: 'email_to_ticket',
      allowedProducts: ['psa', 'algadesk'],
    });

    if (!state.providerId) {
      return NextResponse.json({ error: 'Missing providerId' }, { status: 400 });
    }

    const provider = await db.table('email_providers')
      .where({ id: state.providerId, provider_type: 'imap' })
      .first();

    if (!provider) {
      return NextResponse.json({ error: 'IMAP provider not found' }, { status: 404 });
    }

    const imapConfig = await db.table('imap_email_provider_config')
      .where({ email_provider_id: state.providerId })
      .first();

    if (!imapConfig) {
      return NextResponse.json({ error: 'IMAP provider config not found' }, { status: 404 });
    }

    if (!imapConfig.oauth_token_url || !imapConfig.oauth_client_id) {
      return NextResponse.json({ error: 'IMAP OAuth token configuration missing' }, { status: 400 });
    }

    // Validate old stored URLs at use time; earlier validation only ran while
    // saving settings and cannot protect configurations that predate that check.
    try {
      await assertPublicHttpsUrl(imapConfig.oauth_token_url);
      await assertSafeImapOauthTokenEndpoint(imapConfig.oauth_token_url);
    } catch {
      return NextResponse.json({ error: 'IMAP OAuth token URL is not allowed' }, { status: 400 });
    }

    const secretProvider = await getSecretProviderInstance();
    const { clientSecret, refreshToken: existingRefreshToken } = await getImapOauthAuthorizationCredentials({
      ...imapConfig,
      id: state.providerId,
      tenant,
    });

    const params = new URLSearchParams();
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', state.redirectUri);
    params.append('client_id', imapConfig.oauth_client_id);
    if (clientSecret) {
      params.append('client_secret', clientSecret);
    }

    let tokenResponse;
    try {
      tokenResponse = await postSafeOutboundForm<{
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
      }>(imapConfig.oauth_token_url, params);
    } catch {
      // Do not log request objects: HTTP clients may include form data with the
      // client secret in their error details.
      console.warn('IMAP OAuth token exchange failed');
      return NextResponse.json(
        { error: 'IMAP OAuth token exchange failed. Start the reconnect flow again.' },
        { status: 400 }
      );
    }

    const accessToken = tokenResponse.data.access_token;
    const refreshToken = tokenResponse.data.refresh_token || existingRefreshToken;
    const expiresIn = Number(tokenResponse.data.expires_in || 3600);
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    if (!accessToken) {
      return NextResponse.json(
        { error: 'IMAP OAuth did not return an access token. Start the reconnect flow again.' },
        { status: 400 }
      );
    }
    if (!refreshToken) {
      return NextResponse.json(
        { error: 'IMAP OAuth did not return a refresh token. Reauthorize the mailbox with offline access.' },
        { status: 400 }
      );
    }

    const boundSecretNames = getImapOauthSecretNames({
      id: state.providerId,
      oauth_token_url: imapConfig.oauth_token_url,
      oauth_credentials_secret_version: 1,
    });
    if (clientSecret) {
      await secretProvider.setTenantSecret(tenant, boundSecretNames.clientSecret, clientSecret);
    }
    if (refreshToken) {
      await secretProvider.setTenantSecret(tenant, boundSecretNames.refreshToken, refreshToken);
    }

    await db.table('imap_email_provider_config')
      .where({ email_provider_id: state.providerId })
      .update({
        access_token: accessToken,
        refresh_token: refreshToken || null,
        token_expires_at: expiresAt,
        oauth_credentials_token_url: imapConfig.oauth_token_url,
        oauth_credentials_secret_version: 1,
        oauth_reauthorization_required: false,
        updated_at: knex.fn.now(),
      });

    await db.table('email_providers')
      .where({ id: state.providerId })
      .update({
        status: 'connected',
        error_message: null,
        updated_at: knex.fn.now(),
      });

    // A successful reconnect for a provider auto-paused on repeated auth
    // failures must resume ingestion only after reconciling the paused
    // interval: recovery clears UID/folder cursors (bounded rescan with
    // dedupe) and only then clears the pause. The token exchange above
    // validated the new credentials.
    if (provider.inbound_paused_at && provider.inbound_pause_reason === 'auth_failure') {
      try {
        const { EmailProviderLifecycleService } = await import(
          '@alga-psa/shared/services/email/EmailProviderLifecycleService'
        );
        const recovery = await new EmailProviderLifecycleService().recoverAuthPausedProvider(
          state.providerId,
          tenant,
          { credentialsValidated: true }
        );
        console.info('IMAP auth-failure recovery after reconnect', {
          tenant,
          providerId: state.providerId,
          resumed: recovery.resumed,
          reconciliation: recovery.reconciliation,
          error: recovery.error,
        });
      } catch (recoveryError) {
        console.warn('IMAP auth-failure recovery after reconnect failed (provider stays paused)', {
          tenant,
          providerId: state.providerId,
          error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
        });
      }
    }

    // `state.redirectUri` was captured when the flow started (absolute, from the public
    // base URL, or an app path). With none, stay in the app via a relative Location:
    // the request origin is the internal upstream behind the proxy.
    const rawSuccessRedirect = state.redirectUri;
    if (!rawSuccessRedirect) return redirectToAppPath('/');

    // Prevent redirecting back to this callback endpoint, which causes a second
    // request without code/state and surfaces a false "Missing code/state" error.
    const isAppPath = rawSuccessRedirect.startsWith('/') && !rawSuccessRedirect.startsWith('//');
    try {
      const parsed = new URL(rawSuccessRedirect, 'http://app-path.invalid');
      if (parsed.pathname === '/api/email/oauth/imap/callback') {
        parsed.pathname = '/msp/settings/email';
        parsed.searchParams.set('imapOAuth', 'success');
        parsed.searchParams.set('providerId', state.providerId);
        return isAppPath
          ? redirectToAppPath(`${parsed.pathname}${parsed.search}${parsed.hash}`)
          : NextResponse.redirect(parsed);
      }
    } catch {
      // Keep original redirect target if it cannot be parsed.
    }

    return isAppPath ? redirectToAppPath(rawSuccessRedirect) : NextResponse.redirect(rawSuccessRedirect);
  } catch (error: any) {
    if (isProductAccessError(error)) {
      return toProductAccessDeniedResponse(error);
    }
    // Provider, database, or HTTP client errors can carry sensitive request
    // details. Keep callback failures observable without logging their payload.
    console.error('IMAP OAuth callback failed');
    return NextResponse.json({ error: 'Failed to finalize IMAP OAuth. Please try again.' }, { status: 500 });
  }
}
