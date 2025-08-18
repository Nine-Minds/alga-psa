import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getSecretProviderInstance } from '@alga-psa/shared/core';
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
      console.error('Microsoft OAuth error:', error, errorDescription);
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
      stateData = JSON.parse(Buffer.from(state, 'base64').toString());
    } catch (e) {
      console.error('Failed to parse state:', e);
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
    let tenantAuthority: string | null = null;
    const nextauthUrl = process.env.NEXTAUTH_URL || (await secretProvider.getAppSecret('NEXTAUTH_URL')) || '';
    const isHostedFlow = nextauthUrl.startsWith('https://algapsa.com');
    
    if (isHostedFlow) {
      // Use app-level configuration
      clientId = await secretProvider.getAppSecret('MICROSOFT_CLIENT_ID') || null;
      clientSecret = await secretProvider.getAppSecret('MICROSOFT_CLIENT_SECRET') || null;
      tenantAuthority = await secretProvider.getAppSecret('MICROSOFT_TENANT_ID') || null;
    } else {
      // Use tenant-specific or fallback credentials
      clientId = process.env.MICROSOFT_CLIENT_ID || await secretProvider.getTenantSecret(stateData.tenant, 'microsoft_client_id') || null;
      clientSecret = process.env.MICROSOFT_CLIENT_SECRET || await secretProvider.getTenantSecret(stateData.tenant, 'microsoft_client_secret') || null;
      tenantAuthority = process.env.MICROSOFT_TENANT_ID || await secretProvider.getTenantSecret(stateData.tenant, 'microsoft_tenant_id') || null;
    }
    
    // Resolve redirect URI with priority:
    // 1) Hosted: app-level MICROSOFT_REDIRECT_URI
    // 2) Self-hosted: process.env or tenant secret microsoft_redirect_uri
    // 3) State-provided redirectUri (from initiation)
    // 4) Fallback to NEXT_PUBLIC_BASE_URL + route
    const hostedRedirect = await secretProvider.getAppSecret('MICROSOFT_REDIRECT_URI');
    const tenantRedirect = await secretProvider.getTenantSecret(stateData.tenant, 'microsoft_redirect_uri');
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || (await secretProvider.getAppSecret('NEXT_PUBLIC_BASE_URL')) || 'http://localhost:3000';
    const redirectUri = (isHostedFlow
      ? hostedRedirect
      : (process.env.MICROSOFT_REDIRECT_URI || tenantRedirect)
    ) || stateData.redirectUri || `${baseUrl}/api/auth/microsoft/callback`;

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
      const authority = tenantAuthority || 'common';
      const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(authority)}/oauth2/v2.0/token`;
      const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        scope: 'https://graph.microsoft.com/.default offline_access'
      });

      const response = await axios.post(tokenUrl, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const { access_token, refresh_token, expires_in } = response.data;

      // Calculate expiration time
      const expiresAt = new Date(Date.now() + expires_in * 1000);

      // Return success with tokens
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
      console.error('Failed to exchange authorization code:', tokenError.response?.data || tokenError.message);
      
      return respondWithPostMessage({
        type: 'oauth-callback',
        provider: 'microsoft',
        success: false,
        error: 'token_exchange_failed',
        errorDescription: tokenError.response?.data?.error_description || tokenError.message
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
