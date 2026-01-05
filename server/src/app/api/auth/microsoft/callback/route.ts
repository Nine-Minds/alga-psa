import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getSecretProviderInstance } from '@alga-psa/shared/core';
import { createTenantKnex, runWithTenant } from '../../../../../lib/db';
import { MicrosoftGraphAdapter } from '@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter';
import { getWebhookBaseUrl } from '../../../../../utils/email/webhookHelpers';
import axios from 'axios';

export const dynamic = 'force-dynamic';

/**
 * Microsoft OAuth callback endpoint
 * Handles the authorization code exchange for access and refresh tokens
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    // Helper: return a safe HTML page that posts a base64-encoded payload to the opener and closes
    const respondWithPostMessage = (payload: any) => {
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
      const html = `<!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Microsoft OAuth Callback</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Oxygen, Ubuntu, Cantarell, Helvetica, Arial, sans-serif; padding: 24px; }
            .container { max-width: 640px; margin: 0 auto; }
            .status { margin-top: 12px; color: #444; }
            pre { background: #f6f8fa; padding: 12px; overflow: auto; border-radius: 6px; }
            .ok { color: #0a7f2e; }
            .err { color: #b00020; }
            button { margin-top: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h3>Microsoft OAuth ${payload.success ? 'Success' : 'Error'}</h3>
            <div id="status" class="status">Completing sign-in…</div>
            <div id="details-wrap" style="display:none">
              <p class="${payload.success ? 'ok' : 'err'}">${payload.success ? 'Authorized successfully.' : 'Authorization failed.'}</p>
              <pre id="details"></pre>
              <button onclick="window.close()">Close window</button>
            </div>
          </div>
          <script>
            (function(){
              try {
                var payload = JSON.parse(atob('${encoded}'));
                var target = window.opener || window.parent;
                if (target && target !== window) {
                  target.postMessage(payload, '*');
                }
              } catch (e) { /* ignore */ }
              try { window.close(); } catch (_) {}
              // If the window didn't close (popup blockers), show details for the user
              setTimeout(function(){
                if (!window.closed) {
                  document.getElementById('status').textContent = 'You can close this window.';
                  var wrap = document.getElementById('details-wrap');
                  var pre = document.getElementById('details');
                  wrap.style.display = 'block';
                  try { pre.textContent = JSON.stringify(JSON.parse(atob('${encoded}')), null, 2); } catch(_) { pre.textContent = 'Unable to display details.'; }
                }
              }, 100);
            })();
          </script>
          <noscript>
            <div class="status">JavaScript is required to complete sign-in. Please close this window.</div>
          </noscript>
        </body>
      </html>`;
      return new NextResponse(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
    };

    // Handle OAuth errors
    if (error) {
      console.error('[MS OAuth] OAuth error from Microsoft:', {
        error,
        errorDescription: errorDescription || '',
        code: searchParams.get('code'),
        state: searchParams.get('state')
      });
      return respondWithPostMessage({
        type: 'oauth-callback',
        provider: 'microsoft',
        success: false,
        error,
        errorDescription: errorDescription || ''
      });
    }

    // Validate required parameters
    if (!code || !state) {
      return respondWithPostMessage({
        type: 'oauth-callback',
        provider: 'microsoft',
        success: false,
        error: 'missing_parameters',
        errorDescription: 'Authorization code or state parameter is missing'
      });
    }

    // Parse state to get tenant and other info
    let stateData;
    try {
      const decodedState = Buffer.from(state, 'base64').toString();
      stateData = JSON.parse(decodedState);
    } catch (e: any) {
      console.error('[MS OAuth] Failed to parse state:', {
        error: e.message,
        stateLength: state?.length,
        statePreview: state ? `${state.substring(0, 20)}...` : 'null'
      });
      return respondWithPostMessage({
        type: 'oauth-callback',
        provider: 'microsoft',
        success: false,
        error: 'invalid_state',
        errorDescription: 'Invalid state parameter'
      });
    }

    // Get OAuth client credentials - prefer server-side NEXTAUTH_URL for hosted detection
    const secretProvider = await getSecretProviderInstance();
    let clientId: string | null = null;
    let clientSecret: string | null = null;
    const nextauthUrl = process.env.NEXTAUTH_URL || (await secretProvider.getAppSecret('NEXTAUTH_URL')) || '';
    const isHostedFlow = nextauthUrl.startsWith('https://algapsa.com');
    
    let credentialSource = 'unknown';
    if (isHostedFlow) {
      // Use app-level configuration
      clientId = await secretProvider.getAppSecret('MICROSOFT_CLIENT_ID') || null;
      clientSecret = await secretProvider.getAppSecret('MICROSOFT_CLIENT_SECRET') || null;
      credentialSource = 'app_secret';
    } else {
      // Use tenant-specific or fallback credentials
      const envClientId = process.env.MICROSOFT_CLIENT_ID || null;
      const envClientSecret = process.env.MICROSOFT_CLIENT_SECRET || null;
      const tenantClientId = await secretProvider.getTenantSecret(stateData.tenant, 'microsoft_client_id');
      const tenantClientSecret = await secretProvider.getTenantSecret(stateData.tenant, 'microsoft_client_secret');
      const appClientId = await secretProvider.getAppSecret('MICROSOFT_CLIENT_ID');
      const appClientSecret = await secretProvider.getAppSecret('MICROSOFT_CLIENT_SECRET');
      clientId = envClientId || tenantClientId || appClientId || null;
      clientSecret = envClientSecret || tenantClientSecret || appClientSecret || null;
      credentialSource = envClientId && envClientSecret ? 'env'
        : tenantClientId && tenantClientSecret ? 'tenant_secret'
        : appClientId && appClientSecret ? 'app_secret'
        : 'unknown';
    }
    // Normalize whitespace just in case the secret was copied with spaces/newlines
    clientId = clientId?.trim() || null;
    clientSecret = clientSecret?.trim() || null;
    
    // Resolve redirect URI with priority:
    // CRITICAL: The redirect URI MUST match exactly what was used in the authorization URL
    // Priority: State-provided redirectUri (what was actually used) > configured values > fallback
    const hostedRedirect = await secretProvider.getAppSecret('MICROSOFT_REDIRECT_URI');
    const tenantRedirect = await secretProvider.getTenantSecret(stateData.tenant, 'microsoft_redirect_uri');
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || (await secretProvider.getAppSecret('NEXT_PUBLIC_BASE_URL')) || 'http://localhost:3000';
    
    // Use state-provided redirectUri first (this is what was used in authorization URL)
    // Only fall back to configured values if state doesn't have it
    const redirectUri = stateData.redirectUri || (
      isHostedFlow
        ? hostedRedirect
        : (process.env.MICROSOFT_REDIRECT_URI || tenantRedirect)
    ) || `${baseUrl}/api/auth/microsoft/callback`;

    // Log non-sensitive debug information to help diagnose invalid_client
    const maskedClientId = clientId ? `${clientId.substring(0, 4)}...${clientId.substring(clientId.length - 4)}` : 'null';
    console.log('[MS OAuth] Using credentials', {
      source: credentialSource,
      clientId: maskedClientId,
      redirectUri,
      stateRedirectUri: stateData.redirectUri,
      redirectUriSource: stateData.redirectUri ? 'state' : (isHostedFlow ? 'hosted_config' : 'env_or_tenant')
    });

    if (!clientId || !clientSecret) {
      console.error('Microsoft OAuth credentials not configured');
      return respondWithPostMessage({
        type: 'oauth-callback',
        provider: 'microsoft',
        success: false,
        error: 'configuration_error',
        errorDescription: 'OAuth credentials not configured'
      });
    }

    // Exchange authorization code for tokens
    try {
      const tokenUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/token`;
      const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        scope: 'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Read.Shared offline_access'
      });

      const response = await axios.post(tokenUrl, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const { access_token, refresh_token, expires_in } = response.data;

      // Calculate expiration time
      const expiresAt = new Date(Date.now() + expires_in * 1000);

      // Persist tokens and initialize webhook if we have provider context
      if (stateData.providerId && stateData.tenant) {
        try {
          await runWithTenant(stateData.tenant, async () => {
            const { knex } = await createTenantKnex();
            // Save tokens
            await knex('microsoft_email_provider_config')
              .where('email_provider_id', stateData.providerId)
              .andWhere('tenant', stateData.tenant)
              .update({
                access_token: access_token,
                refresh_token: refresh_token || null,
                token_expires_at: expiresAt.toISOString(),
                updated_at: new Date().toISOString(),
              });

            // Mark provider connected
            await knex('email_providers')
              .where('id', stateData.providerId)
              .andWhere('tenant', stateData.tenant)
              .update({
                status: 'connected',
                error_message: null,
                updated_at: knex.fn.now(),
              });

            // Build provider config and register webhook subscription
            try {
              const provider = await knex('email_providers')
                .where('id', stateData.providerId)
                .andWhere('tenant', stateData.tenant)
                .first();

              const msConfig = await knex('microsoft_email_provider_config')
                .where('email_provider_id', stateData.providerId)
                .andWhere('tenant', stateData.tenant)
                .first();

              if (provider && msConfig) {
                const baseUrl = getWebhookBaseUrl();
                const webhookUrl = `${baseUrl}/api/email/webhooks/microsoft`;

                // Determine folder to monitor from saved config (first folder if multiple)
                const folderToMonitor = Array.isArray(msConfig.folder_filters)
                  ? (msConfig.folder_filters[0] || 'Inbox')
                  : (() => { try { const parsed = JSON.parse(msConfig.folder_filters || '[]'); return parsed[0] || 'Inbox'; } catch { return 'Inbox'; } })();

                const providerConfig: any = {
                  id: provider.id,
                  tenant: provider.tenant,
                  name: provider.provider_name || provider.mailbox,
                  provider_type: 'microsoft',
                  mailbox: provider.mailbox,
                  folder_to_monitor: folderToMonitor,
                  active: provider.is_active,
                  webhook_notification_url: webhookUrl,
                  // Persisted and looked up via microsoft vendor config
                  webhook_subscription_id: msConfig.webhook_subscription_id || null,
                  // Use tenant as verification token when none exists yet
                  webhook_verification_token: msConfig.webhook_verification_token || stateData.tenant,
                  webhook_expires_at: msConfig.webhook_expires_at || null,
                  connection_status: provider.status || 'connected',
                  last_connection_test: provider.last_sync_at || null,
                  connection_error_message: provider.error_message || null,
                  created_at: provider.created_at,
                  updated_at: provider.updated_at,
                  provider_config: {
                    client_id: msConfig.client_id,
                    client_secret: msConfig.client_secret,
                    tenant_id: msConfig.tenant_id,
                    access_token: access_token,
                    refresh_token: refresh_token || null,
                    token_expires_at: expiresAt.toISOString(),
                  },
                };

                const adapter = new MicrosoftGraphAdapter(providerConfig);
                try {
                  // Load credentials and authenticated user email before subscription
                  // This ensures mailbox path auto-detection works correctly
                  await adapter.connect();

                  // Context logging before attempting subscription
                  const maskedToken = providerConfig.webhook_verification_token
                    ? `${String(providerConfig.webhook_verification_token).slice(0, 4)}...(${String(providerConfig.webhook_verification_token).length})`
                    : 'none';
                  console.log('[MS OAuth Callback] Registering webhook subscription', {
                    tenant: provider.tenant,
                    providerId: provider.id,
                    mailbox: provider.mailbox,
                    url: webhookUrl,
                    clientState: maskedToken,
                  });

                  await adapter.registerWebhookSubscription();

                  console.log('[MS OAuth Callback] Webhook subscription registration attempted');
                } catch (subErr: any) {
                  console.warn('⚠️ Failed to register Microsoft webhook subscription in callback:', {
                    message: subErr?.message || String(subErr),
                    status: subErr?.status,
                    code: subErr?.code,
                    requestId: subErr?.requestId,
                  });
                }
              }
            } catch (e) {
              console.warn('⚠️ Skipped webhook initialization after OAuth due to setup error:', (e as any)?.message || e);
            }
          });
        } catch (persistErr: any) {
          console.warn('⚠️ Failed to persist Microsoft OAuth tokens or initialize webhook:', persistErr?.message || persistErr);
        }
      }

      // Return success with tokens back to the opener
      return respondWithPostMessage({
        type: 'oauth-callback',
        provider: 'microsoft',
        success: true,
        data: {
          accessToken: access_token,
          refreshToken: refresh_token,
          expiresAt: expiresAt.toISOString(),
          code,
          state
        }
      });
    } catch (tokenError: any) {
      const errorData = tokenError.response?.data || {};
      const errorMessage = errorData.error_description || errorData.error || tokenError.message;
      const errorCode = errorData.error || 'token_exchange_failed';
      
      console.error('[MS OAuth] Failed to exchange authorization code:', {
        error: errorCode,
        errorDescription: errorMessage,
        status: tokenError.response?.status,
        statusText: tokenError.response?.statusText,
        requestUrl: tokenError.config?.url,
        redirectUri: redirectUri,
        clientId: clientId ? `${clientId.substring(0, 4)}...${clientId.substring(clientId.length - 4)}` : 'null',
        hasCode: !!code,
        hasState: !!state
      });
      
      return respondWithPostMessage({
        type: 'oauth-callback',
        provider: 'microsoft',
        success: false,
        error: errorCode,
        errorDescription: errorMessage
      });
    }
  } catch (error: any) {
    console.error('Unexpected error in Microsoft OAuth callback:', error);
    return new NextResponse(
      (() => {
        const encoded = Buffer.from(JSON.stringify({
          type: 'oauth-callback',
          provider: 'microsoft',
          success: false,
          error: 'unexpected_error',
          errorDescription: error?.message || 'Unexpected error'
        })).toString('base64');
        return `<!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8" />
            <title>Microsoft OAuth Callback</title>
          </head>
          <body>
            <script>
              (function(){
                try { var payload = JSON.parse(atob('${encoded}')); (window.opener||window.parent).postMessage(payload, '*'); } catch(_) {}
                try { window.close(); } catch(_) {}
                setTimeout(function(){ if(!window.closed){ document.body.innerHTML = '<p>Authorization failed. You can close this window.</p>'; } }, 100);
              })();
            </script>
          </body>
        </html>`;
      })(),
      { status: 200, headers: { 'Content-Type': 'text/html' } }
    );
  }
}
