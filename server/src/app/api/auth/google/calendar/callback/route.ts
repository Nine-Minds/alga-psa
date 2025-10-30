import { NextRequest, NextResponse } from 'next/server';
import { getSecretProviderInstance } from '@alga-psa/shared/core';
import { createTenantKnex, runWithTenant } from '../../../../../lib/db';
import { CalendarProviderService } from '../../../../../services/calendar/CalendarProviderService';
import { GoogleCalendarAdapter } from '../../../../../services/calendar/providers/GoogleCalendarAdapter';
import axios from 'axios';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

/**
 * Google Calendar OAuth callback endpoint
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
          <title>Google Calendar OAuth Callback</title>
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
            <h3>Google Calendar OAuth ${payload.success ? 'Success' : 'Error'}</h3>
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
      console.error('Google Calendar OAuth error:', error, errorDescription);
      return respondWithPostMessage({
        type: 'oauth-callback',
        provider: 'google',
        resource: 'calendar',
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
        resource: 'calendar',
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
        resource: 'calendar',
        success: false,
        error: 'invalid_state',
        errorDescription: 'Invalid state parameter'
      });
    }

    // Get OAuth client credentials
    const secretProvider = await getSecretProviderInstance();
    const nextauthUrl = process.env.NEXTAUTH_URL || (await secretProvider.getAppSecret('NEXTAUTH_URL')) || '';
    const isHostedFlow = nextauthUrl.startsWith('https://algapsa.com') || stateData.hosted === true;
    
    let clientId: string | null = null;
    let clientSecret: string | null = null;
    let projectId: string | null = null;
    
    if (isHostedFlow) {
      clientId = await secretProvider.getAppSecret('GOOGLE_CLIENT_ID') || null;
      clientSecret = await secretProvider.getAppSecret('GOOGLE_CLIENT_SECRET') || null;
      projectId = await secretProvider.getAppSecret('GOOGLE_PROJECT_ID') || null;
    } else {
      const envClientId = process.env.GOOGLE_CLIENT_ID || null;
      const envClientSecret = process.env.GOOGLE_CLIENT_SECRET || null;
      const envProjectId = process.env.GOOGLE_PROJECT_ID || null;
      const tenantClientId = await secretProvider.getTenantSecret(stateData.tenant, 'google_client_id');
      const tenantClientSecret = await secretProvider.getTenantSecret(stateData.tenant, 'google_client_secret');
      const tenantProjectId = await secretProvider.getTenantSecret(stateData.tenant, 'google_project_id');
      clientId = envClientId || tenantClientId || null;
      clientSecret = envClientSecret || tenantClientSecret || null;
      projectId = envProjectId || tenantProjectId || null;
    }
    
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || (await secretProvider.getAppSecret('NEXT_PUBLIC_BASE_URL')) || 'http://localhost:3000';
    const redirectUri = stateData.redirectUri || `${baseUrl}/api/auth/google/calendar/callback`;

    if (!clientId || !clientSecret) {
      return respondWithPostMessage({
        type: 'oauth-callback',
        provider: 'google',
        resource: 'calendar',
        success: false,
        error: 'configuration_error',
        errorDescription: 'OAuth credentials not configured'
      });
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
      const expiresAt = new Date(Date.now() + expires_in * 1000);

      // Save provider configuration and tokens
      if (stateData.tenant && stateData.calendarProviderId) {
        try {
          await runWithTenant(stateData.tenant, async () => {
            const { knex } = await createTenantKnex();
            const providerService = new CalendarProviderService();
            
            // Get user's calendars
            const tempConfig = {
              id: stateData.calendarProviderId,
              tenant: stateData.tenant,
              name: 'Temp',
              provider_type: 'google' as const,
              calendar_id: 'primary',
              active: true,
              sync_direction: 'bidirectional' as const,
              connection_status: 'configuring' as const,
              provider_config: {
                clientId,
                clientSecret,
                projectId: projectId || '',
                redirectUri,
                accessToken: access_token,
                refreshToken: refresh_token,
                tokenExpiresAt: expiresAt.toISOString()
              },
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            };

            const adapter = new GoogleCalendarAdapter(tempConfig);
            await adapter.connect();
            const calendars = await adapter.listCalendars();
            const primaryCalendar = calendars.find(c => c.primary) || calendars[0];

            if (!primaryCalendar) {
              throw new Error('No calendars found for user');
            }

            // Update provider with tokens and calendar ID
            await providerService.updateProvider(stateData.calendarProviderId, {
              vendorConfig: {
                client_id: clientId,
                client_secret: clientSecret,
                project_id: projectId || '',
                redirect_uri: redirectUri,
                access_token: access_token,
                refresh_token: refresh_token || null,
                token_expires_at: expiresAt.toISOString(),
                calendar_id: primaryCalendar.id
              }
            });

            // Update provider status
            await providerService.updateProviderStatus(stateData.calendarProviderId, {
              status: 'connected',
              errorMessage: null
            });

            // Register webhook subscription if Pub/Sub is configured
            if (projectId) {
              try {
                await adapter.registerWebhookSubscription();
              } catch (webhookError: any) {
                console.warn('⚠️ Failed to register webhook subscription:', webhookError.message);
              }
            }

            console.log(`✅ Google Calendar provider configured successfully: ${stateData.calendarProviderId}`);
          });
        } catch (dbError: any) {
          console.error(`❌ Failed to save calendar provider configuration: ${dbError.message}`, dbError);
          throw dbError;
        }
      }

      // Return success
      return respondWithPostMessage({
        type: 'oauth-callback',
        provider: 'google',
        resource: 'calendar',
        success: true,
        data: {
          accessToken: access_token,
          refreshToken: refresh_token || '',
          expiresAt: expiresAt.toISOString(),
          calendarProviderId: stateData.calendarProviderId
        }
      });
    } catch (error: any) {
      console.error('Google Calendar OAuth token exchange error:', error);
      return respondWithPostMessage({
        type: 'oauth-callback',
        provider: 'google',
        resource: 'calendar',
        success: false,
        error: 'token_exchange_failed',
        errorDescription: error.response?.data?.error_description || error.message || 'Failed to exchange authorization code'
      });
    }
  } catch (error: any) {
    console.error('Google Calendar OAuth callback error:', error);
    return new NextResponse(
      JSON.stringify({
        type: 'oauth-callback',
        provider: 'google',
        resource: 'calendar',
        success: false,
        error: 'internal_error',
        errorDescription: error.message || 'Internal server error'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

