import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers.js';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { tenantDb } from '@alga-psa/db';
import { createTenantKnex, runWithTenant } from '../../../../../lib/db';
import {
  MicrosoftGraphAdapter,
  MicrosoftSubscriptionError,
} from '@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter';
import { resolveMicrosoftConsumerProfileConfig } from '@alga-psa/integrations/lib/microsoftConsumerProfileResolution';
import { getWebhookBaseUrl } from '../../../../../utils/email/webhookHelpers';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import axios from 'axios';
import { getMicrosoftTokenUrl } from '@alga-psa/shared/services/email/microsoftGraphEndpoints';
import { EmailWebhookMaintenanceService } from '@alga-psa/shared/services/email/EmailWebhookMaintenanceService';

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

    const parseStateValue = (rawState: string) => {
      try {
        const decodedState = Buffer.from(rawState, 'base64').toString();
        return JSON.parse(decodedState);
      } catch (e: any) {
        console.error('[MS OAuth] Failed to parse state:', {
          error: e.message,
          stateLength: rawState?.length,
          statePreview: rawState ? `${rawState.substring(0, 20)}...` : 'null'
        });
        return null;
      }
    };

    const persistProviderError = async (stateData: any, errorCode: string, description?: string | null) => {
      if (!stateData?.providerId || !stateData?.tenant) {
        return;
      }

      const sessionUser = await getCurrentUser();
      if (!sessionUser?.tenant || sessionUser.tenant !== stateData.tenant) {
        console.error('[MS OAuth] Skipping provider error persistence because session tenant does not match state tenant', {
          hasSession: Boolean(sessionUser?.tenant),
          stateTenant: stateData.tenant,
        });
        return;
      }

      const message = [errorCode, description].filter(Boolean).join(': ');
      await runWithTenant(stateData.tenant, async () => {
        const { knex } = await createTenantKnex();
        await tenantDb(knex, stateData.tenant)
          .table('email_providers')
          .where({ id: stateData.providerId })
          .update({
            status: 'error',
            error_message: message,
            updated_at: knex.fn.now(),
          });
      });
    };

    // Handle OAuth errors
    if (error) {
      const errorStateData = state ? parseStateValue(state) : null;
      if (errorStateData?.providerId) {
        try {
          await persistProviderError(errorStateData, error, errorDescription || '');
        } catch (persistError: any) {
          console.warn('⚠️ Failed to persist Microsoft OAuth error:', persistError?.message || persistError);
        }
      }

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
        errorDescription: 'Microsoft authorization failed. Please try again.'
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
      stateData = parseStateValue(state);
      if (!stateData) {
        throw new Error('Invalid state parameter');
      }
    } catch (e: any) {
      return respondWithPostMessage({
        type: 'oauth-callback',
        provider: 'microsoft',
        success: false,
        error: 'invalid_state',
        errorDescription: 'Invalid state parameter'
      });
    }

    // The state parameter is not integrity-protected, so its tenant cannot be
    // trusted on its own. Require an authenticated session whose tenant matches
    // the state tenant before writing any tokens — otherwise a forged callback
    // could overwrite another tenant's email provider credentials.
    const sessionUser = await getCurrentUser();
    if (!sessionUser?.tenant || sessionUser.tenant !== stateData.tenant) {
      console.error('[MS OAuth] Session tenant does not match state tenant', {
        hasSession: Boolean(sessionUser?.tenant),
        stateTenant: stateData.tenant,
      });
      return respondWithPostMessage({
        type: 'oauth-callback',
        provider: 'microsoft',
        success: false,
        error: 'tenant_mismatch',
        errorDescription: 'Your session does not match the requested tenant. Please sign in and retry.'
      });
    }

    // Get OAuth client credentials - prefer server-side NEXTAUTH_URL for hosted detection
    const secretProvider = await getSecretProviderInstance();
    let clientId: string | null = null;
    let clientSecret: string | null = null;
    const nextauthUrl = process.env.NEXTAUTH_URL || (await secretProvider.getAppSecret('NEXTAUTH_URL')) || '';
    const isHostedFlow = nextauthUrl.startsWith('https://algapsa.com');
    const microsoftProfile = await resolveMicrosoftConsumerProfileConfig(stateData.tenant, 'email');

    let credentialSource = 'binding';
    if (microsoftProfile.status === 'ready') {
      clientId = microsoftProfile.clientId || null;
      clientSecret = microsoftProfile.clientSecret || null;
    } else {
      credentialSource = 'unavailable';
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
      try {
        await persistProviderError(stateData, 'configuration_error', 'OAuth credentials not configured');
      } catch (persistError: any) {
        console.warn('⚠️ Failed to persist Microsoft OAuth configuration error:', persistError?.message || persistError);
      }
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
      const tokenUrl = getMicrosoftTokenUrl('common');
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
            const db = tenantDb(knex, stateData.tenant);
            // Save tokens
            await db.table('microsoft_email_provider_config')
              .where('email_provider_id', stateData.providerId)
              .update({
                access_token: access_token,
                refresh_token: refresh_token || null,
                token_expires_at: expiresAt.toISOString(),
                client_id: clientId,
                client_secret: clientSecret,
                tenant_id: microsoftProfile.status === 'ready' ? microsoftProfile.microsoftTenantId || 'common' : 'common',
                microsoft_profile_id: microsoftProfile.status === 'ready' ? microsoftProfile.profileId || null : null,
                client_secret_ref: microsoftProfile.status === 'ready' ? microsoftProfile.clientSecretRef || null : null,
                updated_at: new Date().toISOString(),
              });

            // Mark provider connected
            await db.table('email_providers')
              .where('id', stateData.providerId)
              .update({
                status: 'connected',
                error_message: null,
                updated_at: knex.fn.now(),
              });

            // Build provider config and register webhook subscription
            try {
              const provider = await db.table('email_providers')
                .where('id', stateData.providerId)
                .first();

              const msConfig = await db.table('microsoft_email_provider_config')
                .where('email_provider_id', stateData.providerId)
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
                    client_id: clientId,
                    client_secret: clientSecret,
                    tenant_id: microsoftProfile.status === 'ready' ? microsoftProfile.microsoftTenantId : null,
                    access_token: access_token,
                    refresh_token: refresh_token || null,
                    token_expires_at: expiresAt.toISOString(),
                    microsoft_profile_id: microsoftProfile.status === 'ready' ? microsoftProfile.profileId : undefined,
                    client_secret_ref: microsoftProfile.status === 'ready' ? microsoftProfile.clientSecretRef : undefined,
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
                  await new EmailWebhookMaintenanceService().recordWebhookDeliveryMode({
                    providerId: provider.id,
                    tenant: provider.tenant,
                    reason: 'OAuth setup subscription succeeded',
                  });

                  console.log('[MS OAuth Callback] Webhook subscription registration attempted');
                } catch (subErr: any) {
                  if (subErr instanceof MicrosoftSubscriptionError && subErr.kind === 'validation') {
                    const nextProbeAt = await new EmailWebhookMaintenanceService().usePollingDelivery({
                      providerId: provider.id,
                      tenant: provider.tenant,
                      reason: subErr.message,
                    });
                    console.info('[MS OAuth Callback] Webhook endpoint validation failed; using polling delivery', {
                      tenant: provider.tenant,
                      providerId: provider.id,
                      nextProbeAt,
                    });
                    return;
                  }
                  console.warn('⚠️ Failed to register Microsoft webhook subscription in callback:', {
                    message: subErr?.message || String(subErr),
                    status: subErr?.status,
                    code: subErr?.code,
                    requestId: subErr?.requestId,
                  });
                  throw subErr;
                }
              }
            } catch (e) {
              console.warn('⚠️ Microsoft webhook initialization failed after OAuth:', (e as any)?.message || e);
              throw e;
            }
          });
        } catch (persistErr: any) {
          console.warn('⚠️ Failed to persist Microsoft OAuth tokens or initialize webhook:', persistErr?.message || persistErr);
          try {
            await persistProviderError(stateData, 'token_persistence_failed', persistErr?.message || 'Failed to persist Microsoft OAuth tokens or initialize webhook');
          } catch (providerErrorPersistErr: any) {
            console.warn('⚠️ Failed to persist Microsoft OAuth token persistence error:', providerErrorPersistErr?.message || providerErrorPersistErr);
          }
          return respondWithPostMessage({
            type: 'oauth-callback',
            provider: 'microsoft',
            success: false,
            error: 'token_persistence_failed',
            errorDescription: persistErr?.message || 'Failed to persist Microsoft OAuth tokens or initialize webhook'
          });
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

      try {
        await persistProviderError(stateData, errorCode, errorMessage);
      } catch (persistError: any) {
        console.warn('⚠️ Failed to persist Microsoft OAuth token exchange error:', persistError?.message || persistError);
      }
      
      return respondWithPostMessage({
        type: 'oauth-callback',
        provider: 'microsoft',
        success: false,
        error: errorCode,
        errorDescription: 'Microsoft authorization failed. Please try again.'
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
          errorDescription: 'Microsoft authorization failed. Please try again.'
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
