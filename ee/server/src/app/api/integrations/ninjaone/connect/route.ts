export const dynamic = 'force-dynamic';

/**
 * NinjaOne OAuth Connect Endpoint
 *
 * Initiates the OAuth flow by redirecting the user to NinjaOne's authorization page.
 * The user selects their NinjaOne region before initiating this flow.
 */

import { NextResponse, NextRequest } from 'next/server';
import crypto from 'crypto';
import fs from 'fs';
import { getSecretProviderInstance } from '@alga-psa/shared/core/secretProvider';
import { createTenantKnex } from '../../../../../lib/db';
import { NINJAONE_REGIONS, NinjaOneRegion } from '../../../../../interfaces/ninjaone.interfaces';

// Secret name for NinjaOne client ID
const NINJAONE_CLIENT_ID_SECRET = 'ninjaone_client_id';

// Path to ngrok URL file (written by ngrok-sync container)
const NGROK_URL_FILE = '/app/ngrok/url';

// Check if running in development mode
const isDevelopment = process.env.NODE_ENV === 'development' || process.env.APP_ENV === 'development';

// Redirect URI - uses ngrok URL in development, otherwise NEXTAUTH_URL
const getRedirectUri = () => {
  // If explicitly set, use that
  if (process.env.NINJAONE_REDIRECT_URI) {
    return process.env.NINJAONE_REDIRECT_URI;
  }

  // In development mode, check for ngrok URL file first
  if (isDevelopment) {
    try {
      if (fs.existsSync(NGROK_URL_FILE)) {
        const ngrokUrl = fs.readFileSync(NGROK_URL_FILE, 'utf-8').trim();
        if (ngrokUrl) {
          console.log(`[NinjaOne Connect] Using ngrok URL for redirect URI: ${ngrokUrl}`);
          return `${ngrokUrl}/api/integrations/ninjaone/callback`;
        }
      }
    } catch (error) {
      // Ignore file read errors, fall back to env vars
      console.debug('[NinjaOne Connect] Could not read ngrok URL file, using environment variables');
    }
  }

  // Fall back to environment variables
  const baseUrl = process.env.NEXTAUTH_URL || process.env.APP_BASE_URL || 'http://localhost:3000';
  return `${baseUrl}/api/integrations/ninjaone/callback`;
};

// OAuth scopes - omitted to use application's configured scopes in NinjaOne dashboard
// Available scopes: monitoring, management, control, offline_access

export async function GET(request: NextRequest) {
  let tenantId: string | null = null;

  try {
    // Get tenant ID from the current context
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      console.error('[NinjaOne Connect] Tenant ID not found in current context.');
      return NextResponse.json({ error: 'Unauthorized - Tenant ID missing' }, { status: 401 });
    }
    tenantId = tenant;

    // Get the region from query parameters (defaults to US)
    const searchParams = request.nextUrl.searchParams;
    const region = (searchParams.get('region') || 'US') as NinjaOneRegion;

    // Validate region
    if (!NINJAONE_REGIONS[region]) {
      return NextResponse.json(
        { error: `Invalid region: ${region}. Valid regions are: ${Object.keys(NINJAONE_REGIONS).join(', ')}` },
        { status: 400 }
      );
    }

    // Get the secret provider instance
    const secretProvider = await getSecretProviderInstance();

    // Retrieve NinjaOne Client ID (App-level secret) with fallback to environment variable
    let clientId = await secretProvider.getAppSecret(NINJAONE_CLIENT_ID_SECRET);
    if (!clientId) {
      clientId = process.env.NINJAONE_CLIENT_ID;
    }

    if (!clientId) {
      console.error('[NinjaOne Connect] Missing NinjaOne Client ID in secrets or environment variables.');
      return NextResponse.json(
        { error: 'NinjaOne integration is not configured correctly. Please set NINJAONE_CLIENT_ID environment variable or configure the secret.' },
        { status: 500 }
      );
    }

    // Generate secure CSRF token
    const csrfToken = crypto.randomBytes(16).toString('hex');

    // Create the state parameter including tenantId, region, and CSRF token
    const statePayload = {
      tenantId,
      region,
      csrf: csrfToken,
      timestamp: Date.now(),
    };
    const state = Buffer.from(JSON.stringify(statePayload)).toString('base64url');

    // Get the appropriate NinjaOne instance URL for the region
    const instanceUrl = NINJAONE_REGIONS[region];
    const redirectUri = getRedirectUri();

    // Construct the authorization URL
    // Note: scope is omitted to use application's configured scopes in NinjaOne dashboard
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      state: state,
    });

    const authorizationUrl = `${instanceUrl}/oauth/authorize?${params.toString()}`;

    console.log(`[NinjaOne Connect] Redirecting tenant ${tenantId} to NinjaOne (${region}) for authorization.`);
    console.log(`[NinjaOne Connect] Redirect URI: ${redirectUri}`);
    console.log(`[NinjaOne Connect] Authorization URL: ${authorizationUrl}`);

    // Redirect the user's browser to NinjaOne
    return NextResponse.redirect(authorizationUrl);

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[NinjaOne Connect] Error initiating OAuth flow for tenant ${tenantId || 'UNKNOWN'}:`, errorMessage);
    return NextResponse.json(
      { error: 'Failed to initiate NinjaOne connection.' },
      { status: 500 }
    );
  }
}
