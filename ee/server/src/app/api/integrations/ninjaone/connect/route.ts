export const dynamic = 'force-dynamic';

/**
 * NinjaOne OAuth Connect Endpoint
 *
 * Initiates the OAuth flow by redirecting the user to NinjaOne's authorization page.
 * The user selects their NinjaOne region before initiating this flow.
 */

import { NextResponse, NextRequest } from 'next/server';
import crypto from 'crypto';
import { getSecretProviderInstance } from '@alga-psa/shared/core/secretProvider';
import { createTenantKnex } from '../../../../../../lib/db';
import { NINJAONE_REGIONS, NinjaOneRegion } from '../../../../../interfaces/ninjaone.interfaces';

// Secret name for NinjaOne client ID
const NINJAONE_CLIENT_ID_SECRET = 'ninjaone_client_id';

// Redirect URI - should be configured in environment
const NINJAONE_REDIRECT_URI = process.env.NINJAONE_REDIRECT_URI ||
  'http://localhost:3000/api/integrations/ninjaone/callback';

// OAuth scopes required for full RMM integration
const NINJAONE_SCOPES = 'monitoring management control offline_access';

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

    // Retrieve NinjaOne Client ID (App-level secret)
    const clientId = await secretProvider.getAppSecret(NINJAONE_CLIENT_ID_SECRET);

    if (!clientId) {
      console.error('[NinjaOne Connect] Missing NinjaOne Client ID in secrets.');
      return NextResponse.json(
        { error: 'NinjaOne integration is not configured correctly.' },
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

    // Construct the authorization URL
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      scope: NINJAONE_SCOPES,
      redirect_uri: NINJAONE_REDIRECT_URI,
      state: state,
    });

    const authorizationUrl = `${instanceUrl}/oauth/authorize?${params.toString()}`;

    console.log(`[NinjaOne Connect] Redirecting tenant ${tenantId} to NinjaOne (${region}) for authorization.`);

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
