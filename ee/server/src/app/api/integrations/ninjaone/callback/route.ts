export const dynamic = 'force-dynamic';

/**
 * NinjaOne OAuth Callback Endpoint
 *
 * Handles the OAuth callback from NinjaOne, exchanges the authorization code
 * for access tokens, and stores the credentials securely.
 */

import { NextResponse, NextRequest } from 'next/server';
import axios from 'axios';
import { getSecretProviderInstance } from '@alga-psa/shared/core/secretProvider';
import { createTenantKnex, runWithTenant } from '../../../../../lib/db';
import {
  NINJAONE_REGIONS,
  NinjaOneRegion,
  NinjaOneOAuthTokenResponse,
  NinjaOneOAuthCredentials,
} from '../../../../../interfaces/ninjaone.interfaces';

// Secret names
const NINJAONE_CLIENT_ID_SECRET = 'ninjaone_client_id';
const NINJAONE_CLIENT_SECRET_SECRET = 'ninjaone_client_secret';
const NINJAONE_CREDENTIALS_SECRET = 'ninjaone_credentials';

// App base URL for redirects - uses NEXTAUTH_URL
const APP_BASE_URL = process.env.NEXTAUTH_URL || process.env.APP_BASE_URL || 'http://localhost:3000';

// Redirect URI - should match the connect endpoint
const getRedirectUri = () => {
  if (process.env.NINJAONE_REDIRECT_URI) {
    return process.env.NINJAONE_REDIRECT_URI;
  }
  return `${APP_BASE_URL}/api/integrations/ninjaone/callback`;
};

// UI redirect URLs
const SUCCESS_REDIRECT_URL = '/msp/settings?tab=integrations&ninjaone_status=success';
const FAILURE_REDIRECT_URL = '/msp/settings?tab=integrations&ninjaone_status=failure&error=';

// State timeout (10 minutes)
const STATE_TIMEOUT_MS = 10 * 60 * 1000;

interface StatePayload {
  tenantId: string;
  region: NinjaOneRegion;
  csrf: string;
  timestamp: number;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const ninjaError = searchParams.get('error');
  const ninjaErrorDescription = searchParams.get('error_description');

  // Helper function to create failure redirect
  const failureRedirect = (errorCode: string, message?: string) => {
    const url = new URL(FAILURE_REDIRECT_URL + encodeURIComponent(errorCode), APP_BASE_URL);
    if (message) {
      url.searchParams.append('message', message);
    }
    console.log(`[NinjaOne Callback] Redirecting to failure URL: ${url.toString()}`);
    return NextResponse.redirect(url);
  };

  // Helper function to create success redirect
  const successRedirect = () => {
    const url = new URL(SUCCESS_REDIRECT_URL, APP_BASE_URL);
    console.log(`[NinjaOne Callback] Redirecting to success URL: ${url.toString()}`);
    return NextResponse.redirect(url);
  };

  // Check for error response from NinjaOne
  if (ninjaError) {
    console.error('[NinjaOne Callback] NinjaOne returned an error:', ninjaError, ninjaErrorDescription);
    return failureRedirect('ninjaone_error', ninjaErrorDescription || ninjaError);
  }

  // Validate required parameters
  if (!code || !state) {
    console.error('[NinjaOne Callback] Missing code or state in callback query parameters.');
    return failureRedirect('missing_params');
  }

  let tenantId: string | null = null;
  let region: NinjaOneRegion = 'US';

  try {
    // 1. Validate and decode state parameter
    let decodedStatePayload: StatePayload;
    try {
      const stateJson = Buffer.from(state, 'base64url').toString('utf-8');
      decodedStatePayload = JSON.parse(stateJson);

      if (!decodedStatePayload.tenantId || !decodedStatePayload.csrf || !decodedStatePayload.region) {
        throw new Error('Invalid state payload structure.');
      }

      tenantId = decodedStatePayload.tenantId;
      region = decodedStatePayload.region;

      // Check state timeout
      const stateAge = Date.now() - decodedStatePayload.timestamp;
      if (stateAge > STATE_TIMEOUT_MS) {
        console.error(`[NinjaOne Callback] State expired for tenant ${tenantId}.`);
        return failureRedirect('state_expired', 'The authorization request has expired. Please try again.');
      }

      console.log(`[NinjaOne Callback] Decoded state for tenant ${tenantId}, region ${region}`);
    } catch (err) {
      console.error('[NinjaOne Callback] Failed to decode or parse state parameter:', err);
      return failureRedirect('invalid_state');
    }

    // TODO: Implement actual CSRF token validation
    // For now, we're relying on the state parameter containing tenant info
    console.log(`[NinjaOne Callback] Processing callback for tenant ${tenantId}`);

    // 2. Get app secrets
    const secretProvider = await getSecretProviderInstance();
    const clientId = await secretProvider.getAppSecret(NINJAONE_CLIENT_ID_SECRET);
    const clientSecret = await secretProvider.getAppSecret(NINJAONE_CLIENT_SECRET_SECRET);

    if (!clientId || !clientSecret) {
      console.error('[NinjaOne Callback] Missing NinjaOne Client ID or Secret in secrets.');
      return failureRedirect('config_error', 'NinjaOne integration is not configured correctly.');
    }

    // 3. Exchange authorization code for tokens
    const instanceUrl = NINJAONE_REGIONS[region];
    const tokenUrl = `${instanceUrl}/oauth/token`;

    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: getRedirectUri(),
      client_id: clientId,
      client_secret: clientSecret,
    });

    console.log(`[NinjaOne Callback] Exchanging code for token for tenant ${tenantId}...`);

    const tokenResponse = await axios.post<NinjaOneOAuthTokenResponse>(
      tokenUrl,
      tokenParams.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        timeout: 15000,
      }
    );

    const {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: accessTokenExpiresIn,
    } = tokenResponse.data;

    if (!accessToken || !refreshToken) {
      console.error(`[NinjaOne Callback] Missing tokens in NinjaOne response for tenant ${tenantId}.`);
      return failureRedirect('token_exchange_failed', 'Failed to obtain access tokens from NinjaOne.');
    }

    console.log(`[NinjaOne Callback] Tokens received for tenant ${tenantId}.`);

    // 4. Calculate expiry timestamp
    const expiresAt = Date.now() + accessTokenExpiresIn * 1000;

    // 5. Store credentials
    const credentials: NinjaOneOAuthCredentials = {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt,
      instance_url: instanceUrl,
    };

    await secretProvider.setTenantSecret(
      tenantId,
      NINJAONE_CREDENTIALS_SECRET,
      JSON.stringify(credentials)
    );

    console.log(`[NinjaOne Callback] Successfully stored NinjaOne credentials for tenant ${tenantId}, region ${region}.`);

    // 6. Create or update the rmm_integrations record
    // Use runWithTenant since this is an OAuth callback without a session
    await runWithTenant(tenantId, async () => {
      const { knex } = await createTenantKnex();

      // Check if integration already exists
      const existingIntegration = await knex('rmm_integrations')
        .where({ tenant: tenantId, provider: 'ninjaone' })
        .first();

      if (existingIntegration) {
        // Update existing integration
        await knex('rmm_integrations')
          .where({ tenant: tenantId, provider: 'ninjaone' })
          .update({
            instance_url: instanceUrl,
            is_active: true,
            connected_at: knex.fn.now(),
            sync_status: 'pending',
            sync_error: null,
            settings: JSON.stringify({
              region,
              ...JSON.parse(existingIntegration.settings || '{}'),
            }),
            updated_at: knex.fn.now(),
          });
        console.log(`[NinjaOne Callback] Updated existing integration for tenant ${tenantId}.`);
      } else {
        // Create new integration record
        await knex('rmm_integrations').insert({
          tenant: tenantId,
          provider: 'ninjaone',
          instance_url: instanceUrl,
          is_active: true,
          connected_at: knex.fn.now(),
          sync_status: 'pending',
          settings: JSON.stringify({ region }),
        });
        console.log(`[NinjaOne Callback] Created new integration for tenant ${tenantId}.`);
      }
    });

    // 7. Redirect to success page
    return successRedirect();

  } catch (error: unknown) {
    console.error(`[NinjaOne Callback] Error during processing for tenant ${tenantId || 'UNKNOWN'}:`, error);

    // Log detailed error info
    if (axios.isAxiosError(error)) {
      console.error('[NinjaOne Callback] Axios error details:', {
        message: error.message,
        code: error.code,
        status: error.response?.status,
        data: error.response?.data,
      });
    } else if (error instanceof Error) {
      console.error('[NinjaOne Callback] Error details:', {
        message: error.message,
        stack: error.stack,
      });
    }

    const errorCode = axios.isAxiosError(error) && error.response?.data?.error
      ? error.response.data.error
      : 'callback_processing_error';
    const errorMessage = axios.isAxiosError(error) && error.response?.data?.error_description
      ? error.response.data.error_description
      : error instanceof Error
        ? error.message
        : 'An unexpected error occurred during the callback process.';

    return failureRedirect(errorCode, errorMessage);
  }
}
