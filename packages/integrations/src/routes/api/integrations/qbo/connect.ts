export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import {
  QBO_OAUTH_CSRF_COOKIE_NAME,
  QBO_OAUTH_CSRF_COOKIE_PATH,
  QBO_OAUTH_CSRF_TTL_SECONDS,
  generateQboOauthCsrfToken,
} from '../../../../lib/qbo/oauthCsrf';

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
    // Resolve the tenant from the authenticated session. The same session is
    // re-checked in the callback, so the state's tenantId cannot be swapped.
    const user = await getCurrentUser();
    if (!user?.tenant) {
      console.error('QBO Connect: No authenticated session found.');
      return NextResponse.json({ error: 'Unauthorized - Tenant ID missing' }, { status: 401 });
    }
    tenantId = user.tenant;

    // Retrieve QBO Client ID (App-level secret) using secret provider
    const clientId = await secretProvider.getAppSecret(QBO_CLIENT_ID_SECRET_NAME);

    if (!clientId) {
      console.error(`QBO Connect: Missing QBO Client ID in secrets.`);
      return NextResponse.json({ error: 'QBO integration is not configured correctly.' }, { status: 500 });
    }

    // Generate secure CSRF token; it travels back in the state parameter and
    // in an HttpOnly cookie that only the initiating browser holds.
    const csrfToken = generateQboOauthCsrfToken();

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
    // Redirect the user's browser, carrying the CSRF token in an HttpOnly
    // cookie scoped to the callback route so the callback can verify that the
    // response landed in the same browser that started the flow.
    const response = NextResponse.redirect(authorizationUrl);
    response.cookies.set(QBO_OAUTH_CSRF_COOKIE_NAME, csrfToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: QBO_OAUTH_CSRF_COOKIE_PATH,
      maxAge: QBO_OAUTH_CSRF_TTL_SECONDS,
    });
    return response;

  } catch (error: any) {
    console.error(`QBO Connect: Error initiating OAuth flow for tenant ${tenantId || 'UNKNOWN'}`, error);
    // Redirect to an error page or return a JSON error
    return NextResponse.json({ error: 'Failed to initiate QuickBooks connection.' }, { status: 500 });
  }
}
