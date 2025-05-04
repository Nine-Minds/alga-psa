import { NextResponse } from 'next/server'; // Keep only one import
import { getCurrentUser } from '../../../../../lib/actions/user-actions/userActions'; // Use relative path
import crypto from 'crypto';
// --- Import Actual Implementations ---
// Assuming ISecretProvider is correctly imported and instantiated elsewhere or via getSecretProvider
import { ISecretProvider } from '../../../../../lib/secrets/ISecretProvider';
// TODO: Import the actual CSRF token storage mechanism
// import { storeCsrfToken } from '../../../../../lib/auth/csrf'; // Hypothetical path removed

// Constants
const INTUIT_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2'; // Use sandbox URL for development if needed
const QBO_SCOPES = 'com.intuit.quickbooks.accounting';
const QBO_CLIENT_ID_SECRET_NAME = 'qbo_client_id'; // Define constant
const QBO_REDIRECT_URI_SECRET_NAME = 'qbo_redirect_uri'; // Define constant

export async function GET(request: Request) {
  let tenantId: string | null = null;
  // TODO: Obtain secretProvider instance (e.g., via dependency injection or factory)
  const secretProvider: ISecretProvider = {} as any; // Placeholder: Assume provider is available

  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.tenant) {
      console.error('QBO Connect: Tenant ID not found in current user session.');
      // Redirecting to an error page might be better UX than just returning JSON
      return NextResponse.json({ error: 'Unauthorized - Tenant ID missing' }, { status: 401 });
    }
    tenantId = currentUser.tenant;

    // Retrieve QBO Client ID (App-level secret) using secret provider
    const clientId = await secretProvider.getAppSecret(QBO_CLIENT_ID_SECRET_NAME);

    // Retrieve Redirect URI using secret provider
    const redirectUri = await secretProvider.getAppSecret(QBO_REDIRECT_URI_SECRET_NAME);

    if (!clientId || !redirectUri) {
      console.error(`QBO Connect: Missing QBO Client ID or Redirect URI in secrets.`); // Removed tenantId from log as these are app secrets
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
      redirect_uri: redirectUri,
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