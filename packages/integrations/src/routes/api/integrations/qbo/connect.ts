export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server'; // Keep only one import
import crypto from 'crypto';
// --- Import Actual Implementations ---
import { ISecretProvider } from '@alga-psa/core'; // Import the interface
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { createTenantKnex } from '@alga-psa/db'; // Import createTenantKnex
import { withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
// TODO: Import the actual CSRF token storage mechanism
// import { storeCsrfToken } from '../../../../../lib/auth/csrf'; // Hypothetical path removed

// Constants
const INTUIT_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2'; // Use sandbox URL for development if needed
const QBO_SCOPES = 'com.intuit.quickbooks.accounting';
const QBO_CLIENT_ID_SECRET_NAME = 'qbo_client_id'; // Define constant
const QBO_REDIRECT_URI = process.env.QBO_REDIRECT_URI || 'http://localhost:3000/api/integrations/qbo/callback';

export async function GET(
  request: Request,
  { params }: { params: Promise<Record<string, string>>}
) {
  let tenantId: string | null = null;
  // Get the secret provider instance
  const secretProvider = await getSecretProviderInstance();

  try {
    // Get tenant ID from knex
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      console.error('QBO Connect: Tenant ID not found in current context.');
      // Redirecting to an error page might be better UX than just returning JSON
      return NextResponse.json({ error: 'Unauthorized - Tenant ID missing' }, { status: 401 });
    }
    tenantId = tenant;

    // Retrieve QBO Client ID (App-level secret) using secret provider
    const clientId = await secretProvider.getAppSecret(QBO_CLIENT_ID_SECRET_NAME);

    if (!clientId) {
      console.error(`QBO Connect: Missing QBO Client ID in secrets.`);
      return NextResponse.json({ error: 'QBO integration is not configured correctly.' }, { status: 500 });
    }

    // Generate secure CSRF token
    const csrfToken = crypto.randomBytes(16).toString('hex');

    // TODO: Store the CSRF token temporarily, associated with the user/tenant session, using the actual mechanism.
    // await storeCsrfToken(tenantId, csrfToken); // Store CSRF token with a short TTL (e.g., 10 minutes)
    console.log(`QBO Connect: Generated CSRF token for tenant ${tenantId}. Needs to be stored.`);

    // Create the state parameter including tenantId and CSRF token
    // Encode as base64url for safe transmission in URL
    const statePayload = {
        tenantId: tenantId, // Include tenantId to link callback to tenant
        csrf: csrfToken,
    };
    const state = Buffer.from(JSON.stringify(statePayload)).toString('base64url');


    // Construct the authorization URL
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      scope: QBO_SCOPES,
      redirect_uri: QBO_REDIRECT_URI,
      state: state,
    });

    const authorizationUrl = `${INTUIT_AUTH_URL}?${params.toString()}`;

    console.log(`QBO Connect: Redirecting tenant ${tenantId} to Intuit for authorization.`);
    // Redirect the user's browser
    return NextResponse.redirect(authorizationUrl);

  } catch (error: any) {
    console.error(`QBO Connect: Error initiating OAuth flow for tenant ${tenantId || 'UNKNOWN'}`, error);
    // Redirect to an error page or return a JSON error
    return NextResponse.json({ error: 'Failed to initiate QuickBooks connection.' }, { status: 500 });
  }
}
