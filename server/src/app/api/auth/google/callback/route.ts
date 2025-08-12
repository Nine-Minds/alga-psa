import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getSecretProviderInstance } from '@alga-psa/shared/core';
import { getAdminConnection } from '@alga-psa/shared/db/admin.js';
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

    // Handle OAuth errors
    if (error) {
      console.error('Google OAuth error:', error, errorDescription);
      
      // Return HTML that communicates with the parent window
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
            <title>Google OAuth Callback</title>
          </head>
          <body>
            <script>
              window.opener.postMessage({
                type: 'oauth-callback',
                provider: 'google',
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
            <title>Google OAuth Callback</title>
          </head>
          <body>
            <script>
              window.opener.postMessage({
                type: 'oauth-callback',
                provider: 'google',
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

    // Get OAuth client credentials - check if this is a hosted EE flow
    const secretProvider = await getSecretProviderInstance();
    // Prefer server-side NEXTAUTH_URL for hosted detection; allow state flag as backup
    const nextauthUrl = process.env.NEXTAUTH_URL || (await secretProvider.getAppSecret('NEXTAUTH_URL')) || '';
    const isHostedByEnv = nextauthUrl.startsWith('https://algapsa.com');
    const isHostedFlow = isHostedByEnv || stateData.hosted === true;
    
    let clientId: string | null = null;
    let clientSecret: string | null = null;
    
    if (isHostedFlow) {
      // Use hosted configuration for Enterprise Edition
      clientId = await secretProvider.getAppSecret('EE_GMAIL_CLIENT_ID') || null;
      clientSecret = await secretProvider.getAppSecret('EE_GMAIL_CLIENT_SECRET') || null;
    } else {
      // Use tenant-specific or fallback credentials
      clientId = await secretProvider.getAppSecret('GOOGLE_CLIENT_ID') || await secretProvider.getTenantSecret(stateData.tenant, 'google_client_id') || null;
      clientSecret = await secretProvider.getAppSecret('GOOGLE_CLIENT_SECRET') || await secretProvider.getTenantSecret(stateData.tenant, 'google_client_secret') || null;
    }
    
    const redirectUri = stateData.redirectUri || `${await secretProvider.getAppSecret('NEXT_PUBLIC_BASE_URL')}/api/auth/google/callback`;

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
          const knex = await getAdminConnection();
          
          await knex('google_email_provider_config')
            .where('email_provider_id', stateData.providerId)
            .update({
              access_token: access_token,
              refresh_token: refresh_token || null,
              token_expires_at: expiresAt.toISOString(),
              updated_at: new Date().toISOString()
            });
            
          console.log(`✅ OAuth tokens saved successfully for provider: ${stateData.providerId}`);
        } catch (dbError: any) {
          console.error(`❌ Failed to save OAuth tokens to database: ${dbError.message}`, dbError);
          // Don't fail the OAuth flow - tokens will still be returned to frontend
        }
      } else {
        console.log('⚠️  No provider ID in state, skipping database token save');
      }

      // Return success with tokens
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
                success: true,
                data: {
                  accessToken: '${access_token}',
                  refreshToken: '${refresh_token || ''}',
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
            <title>Google OAuth Callback</title>
          </head>
          <body>
            <script>
              window.opener.postMessage({
                type: 'oauth-callback',
                provider: 'google',
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
    console.error('Unexpected error in Google OAuth callback:', error);
    
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
