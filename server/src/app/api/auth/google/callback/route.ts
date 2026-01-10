import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getSecretProviderInstance } from '@alga-psa/shared/core';
import { createTenantKnex, runWithTenant } from '../../../../../lib/db';
import { configureGmailProvider } from '../../../../../lib/actions/email-actions/configureGmailProvider';
import axios from 'axios';

// make this dynamic
export const dynamic = 'force-dynamic';

/**
 * Google OAuth callback endpoint
 * Handles the authorization code exchange for access and refresh tokens
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    const errorDescription = searchParams.get('error_description');

    // Helper to respond with a safe base64-encoded payload posted to opener/parent and auto-close
    const respondWithPostMessage = (payload: any) => {
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
      const html = `<!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Google OAuth Callback</title>
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
            <h3>Google OAuth ${payload.success ? 'Success' : 'Error'}</h3>
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
                if (target && target !== window) target.postMessage(payload, '*');
              } catch (e) {}
              try { window.close(); } catch (_) {}
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
        </body>
      </html>`;
      return new NextResponse(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
    };

    // Handle OAuth errors
    if (error) {
      console.error('Google OAuth error:', error, errorDescription);
      return respondWithPostMessage({
        type: 'oauth-callback',
        provider: 'google',
        success: false,
        error,
        errorDescription: errorDescription || ''
      });
    }

    // Validate required parameters
    if (!code || !state) {
      return respondWithPostMessage({
        type: 'oauth-callback',
        provider: 'google',
        success: false,
        error: 'missing_parameters',
        errorDescription: 'Authorization code or state parameter is missing'
      });
    }

    // Parse state to get tenant and other info
    let stateData;
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64').toString());
    } catch (e) {
      console.error('Failed to parse state:', e);
      return respondWithPostMessage({
        type: 'oauth-callback',
        provider: 'google',
        success: false,
        error: 'invalid_state',
        errorDescription: 'Invalid state parameter'
      });
    }

    // Get OAuth client credentials - check if this is a hosted EE flow
    const secretProvider = await getSecretProviderInstance();
    let clientId: string | null = null;
    let clientSecret: string | null = null;

    // Google is always tenant-owned (CE and EE): do not fall back to app-level secrets.
    clientId = (await secretProvider.getTenantSecret(stateData.tenant, 'google_client_id')) ?? null;
    clientSecret = (await secretProvider.getTenantSecret(stateData.tenant, 'google_client_secret')) ?? null;
    clientId = clientId?.trim() || null;
    clientSecret = clientSecret?.trim() || null;
    
    // Redirect URI is deployment-derived; stateData.redirectUri should already match the canonical callback.
    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL ||
      (await secretProvider.getAppSecret('NEXT_PUBLIC_BASE_URL')) ||
      process.env.NEXTAUTH_URL ||
      (await secretProvider.getAppSecret('NEXTAUTH_URL')) ||
      'http://localhost:3000';
    const redirectUri = stateData.redirectUri || `${baseUrl}/api/auth/google/callback`;

    if (!clientId || !clientSecret) {
      console.error('Google OAuth credentials not configured');
      return new NextResponse(
        `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Google OAuth Callback</title>
          </head>
          <body>
            <script>
              window.opener.postMessage({
                type: 'oauth-callback',
                provider: 'google',
                success: false,
                error: 'configuration_error',
                errorDescription: 'OAuth credentials not configured'
              }, '*');
              window.close();
            </script>
          </body>
        </html>
        `,
        {
          status: 200,
          headers: {
            'Content-Type': 'text/html',
          },
        }
      );
    }

    // Exchange authorization code for tokens
    try {
      const tokenUrl = 'https://oauth2.googleapis.com/token';
      const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri
      });

      const response = await axios.post(tokenUrl, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const { access_token, refresh_token, expires_in } = response.data;

      // Calculate expiration time
      const expiresAt = new Date(Date.now() + expires_in * 1000);

      // Save tokens to database if provider ID is available
      if (stateData.providerId) {
        try {
          console.log(`💾 Saving OAuth tokens to database for provider: ${stateData.providerId}`);
          const { knex, tenant } = await createTenantKnex();
          
          await knex('google_email_provider_config')
            .where('email_provider_id', stateData.providerId)
            .modify((qb: any) => {
              // Use the current tenant from context/cookies when available
              if (tenant) {
                qb.andWhere('tenant', tenant);
              }
            })
            .update({
              access_token: access_token,
              refresh_token: refresh_token || null,
              token_expires_at: expiresAt.toISOString(),
              updated_at: new Date().toISOString()
            });
            
          console.log(`✅ OAuth tokens saved successfully for provider: ${stateData.providerId}`);

          // Mark provider connection as connected and clear any previous error
          try {
            await knex('email_providers')
              .where('id', stateData.providerId)
              .modify((qb: any) => {
                if (tenant) qb.andWhere('tenant', tenant);
              })
              .update({
                status: 'connected',
                updated_at: knex.fn.now(),
              });
            console.log(`🔗 Provider ${stateData.providerId} marked as connected`);
          } catch (statusErr: any) {
            console.warn(`⚠️ Failed to update provider connection status for ${stateData.providerId}: ${statusErr.message}`);
          }
        } catch (dbError: any) {
          console.error(`❌ Failed to save OAuth tokens to database: ${dbError.message}`, dbError);
          // Don't fail the OAuth flow - tokens will still be returned to frontend
        }
      } else {
        console.log('⚠️  No provider ID in state, skipping database token save');
      }

      // After saving tokens, try to finalize Gmail setup (Pub/Sub + Watch) for this provider
      // Run with the tenant from state to avoid cookie/header mismatch
      if (stateData.providerId && stateData.tenant) {
        try {
          await runWithTenant(stateData.tenant, async () => {
            const { knex } = await createTenantKnex();
            const googleConfig = await knex('google_email_provider_config')
              .select('project_id')
              .where('email_provider_id', stateData.providerId)
              .andWhere('tenant', stateData.tenant)
              .first();

            if (googleConfig?.project_id) {
              console.log(`🔁 Finalizing Gmail provider after OAuth for provider ${stateData.providerId}`);
              await configureGmailProvider({
                tenant: stateData.tenant,
                providerId: stateData.providerId,
                projectId: googleConfig.project_id,
                force: true
              });
            } else {
              console.warn('⚠️ Skipping Gmail finalize: project_id missing');
            }
          });
        } catch (finalizeError: any) {
          console.error('⚠️ Failed to finalize Gmail provider after OAuth:', finalizeError?.message || finalizeError);
        }
      }

      // Return success with tokens
      return respondWithPostMessage({
        type: 'oauth-callback',
        provider: 'google',
        success: true,
        data: {
          accessToken: access_token,
          refreshToken: refresh_token || '',
          expiresAt: expiresAt.toISOString(),
          code,
          state
        }
      });
    } catch (tokenError: any) {
      console.error('Failed to exchange authorization code:', tokenError.response?.data || tokenError.message);
      
      return respondWithPostMessage({
        type: 'oauth-callback',
        provider: 'google',
        success: false,
        error: 'token_exchange_failed',
        errorDescription: tokenError.response?.data?.error_description || tokenError.message
      });
    }
  } catch (error: any) {
    console.error('Unexpected error in Google OAuth callback:', error);
    
    const encoded = Buffer.from(JSON.stringify({
      type: 'oauth-callback',
      provider: 'google',
      success: false,
      error: 'unexpected_error',
      errorDescription: error?.message || 'Unexpected error'
    })).toString('base64');
    return new NextResponse(`<!DOCTYPE html><html><head><meta charset="utf-8" /><title>Google OAuth Callback</title></head><body><script>(function(){try{var p=JSON.parse(atob('${encoded}'));(window.opener||window.parent).postMessage(p,'*')}catch(_){}try{window.close()}catch(_){}setTimeout(function(){if(!window.closed){document.body.innerHTML='<p>Authorization failed. You can close this window.</p>'}},100)})();</script></body></html>`, { status: 200, headers: { 'Content-Type': 'text/html' } });
  }
}
