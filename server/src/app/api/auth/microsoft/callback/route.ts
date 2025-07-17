import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getSecretProviderInstance } from '@shared/core';
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

    // Handle OAuth errors
    if (error) {
      console.error('Microsoft OAuth error:', error, errorDescription);
      
      // Return HTML that communicates with the parent window
      return new NextResponse(
        `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Microsoft OAuth Callback</title>
          </head>
          <body>
            <script>
              window.opener.postMessage({
                type: 'oauth-callback',
                provider: 'microsoft',
                success: false,
                error: '${error}',
                errorDescription: '${errorDescription || ''}'
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

    // Validate required parameters
    if (!code || !state) {
      return new NextResponse(
        `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Microsoft OAuth Callback</title>
          </head>
          <body>
            <script>
              window.opener.postMessage({
                type: 'oauth-callback',
                provider: 'microsoft',
                success: false,
                error: 'missing_parameters',
                errorDescription: 'Authorization code or state parameter is missing'
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

    // Parse state to get tenant and other info
    let stateData;
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64').toString());
    } catch (e) {
      console.error('Failed to parse state:', e);
      return new NextResponse(
        `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Microsoft OAuth Callback</title>
          </head>
          <body>
            <script>
              window.opener.postMessage({
                type: 'oauth-callback',
                provider: 'microsoft',
                success: false,
                error: 'invalid_state',
                errorDescription: 'Invalid state parameter'
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

    // Get OAuth client credentials from environment/secrets - use tenant-specific secrets
    const secretProvider = getSecretProviderInstance();
    const clientId = process.env.MICROSOFT_CLIENT_ID || await secretProvider.getTenantSecret(stateData.tenant, 'microsoft_client_id');
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET || await secretProvider.getTenantSecret(stateData.tenant, 'microsoft_client_secret');
    const redirectUri = stateData.redirectUri || `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/microsoft/callback`;

    if (!clientId || !clientSecret) {
      console.error('Microsoft OAuth credentials not configured');
      return new NextResponse(
        `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Microsoft OAuth Callback</title>
          </head>
          <body>
            <script>
              window.opener.postMessage({
                type: 'oauth-callback',
                provider: 'microsoft',
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
      const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
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
      return new NextResponse(
        `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Microsoft OAuth Callback</title>
          </head>
          <body>
            <script>
              window.opener.postMessage({
                type: 'oauth-callback',
                provider: 'microsoft',
                success: true,
                data: {
                  accessToken: '${access_token}',
                  refreshToken: '${refresh_token}',
                  expiresAt: '${expiresAt.toISOString()}',
                  code: '${code}',
                  state: '${state}'
                }
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
    } catch (tokenError: any) {
      console.error('Failed to exchange authorization code:', tokenError.response?.data || tokenError.message);
      
      return new NextResponse(
        `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Microsoft OAuth Callback</title>
          </head>
          <body>
            <script>
              window.opener.postMessage({
                type: 'oauth-callback',
                provider: 'microsoft',
                success: false,
                error: 'token_exchange_failed',
                errorDescription: '${tokenError.response?.data?.error_description || tokenError.message}'
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
  } catch (error: any) {
    console.error('Unexpected error in Microsoft OAuth callback:', error);
    
    return new NextResponse(
      `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Microsoft OAuth Callback</title>
        </head>
        <body>
          <script>
            window.opener.postMessage({
              type: 'oauth-callback',
              provider: 'microsoft',
              success: false,
              error: 'unexpected_error',
              errorDescription: '${error.message}'
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
}