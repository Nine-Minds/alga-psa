// server/src/app/api/integrations/qbo/connect/route.ts
import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { URLSearchParams } from 'url';
// TODO: Import the actual secret provider implementation
// import { getAppSecret } from '@/lib/secrets/secretProvider';
// TODO: Import or define how tenantId is accessed (e.g., from session/auth middleware)
// import { getTenantIdFromRequest } from '@/lib/auth/tenant';

// Placeholder for secret retrieval - replace with actual implementation
const getAppSecret = async (secretName: string): Promise<string | undefined> => {
  // In a real scenario, this would use the ISecretProvider implementation
  // configured for the application (e.g., VaultProvider, FileSystemProvider)
  console.log(`[Placeholder] Retrieving app secret: ${secretName}`);
  if (secretName === 'QBO_CLIENT_ID') {
    return process.env.QBO_CLIENT_ID || 'YOUR_QBO_CLIENT_ID_PLACEHOLDER'; // Replace with actual retrieval
  }
  return undefined;
};

// Placeholder for tenant ID retrieval - replace with actual implementation
const getTenantIdFromRequest = (request: Request): string | null => {
  // This should extract the tenantId based on the authentication/session mechanism
  // For App Router, this might involve reading headers set by middleware,
  // or using a server-side session library compatible with edge/node runtimes.
  console.log('[Placeholder] Retrieving tenantId from request');
  // Example: const tenantId = request.headers.get('X-Tenant-ID');
  // For now, returning a placeholder or potentially extracting from query for testing
  const { searchParams } = new URL(request.url);
  return searchParams.get('tenantId') || 'TEST_TENANT_ID_PLACEHOLDER';
};

// Placeholder for CSRF token storage - replace with actual implementation
const storeCsrfToken = async (tenantId: string, csrfToken: string): Promise<void> => {
  // This should store the CSRF token securely, associated with the tenantId,
  // with a short expiration (e.g., in Redis cache or session state).
  console.log(`[Placeholder] Storing CSRF token for tenant ${tenantId}: ${csrfToken}`);
  // Example: await redis.set(`qbo:csrf:${tenantId}`, csrfToken, 'EX', 300); // Store for 5 minutes
};

// Configuration (should ideally come from environment variables or config files)
const QBO_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const QBO_SCOPES = [
  'com.intuit.quickbooks.accounting',
  'openid',
  'profile',
  'email',
  'phone',
  'address',
].join(' ');
// Use NEXT_PUBLIC_APP_URL for client-side accessible base URL if needed elsewhere,
// but for server-side redirects, ensure this resolves correctly.
// Using process.env.APP_BASE_URL assuming it's set correctly for the server environment.
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';
// IMPORTANT: The redirect URI registered with QBO MUST match this EXACTLY.
const REGISTERED_REDIRECT_URI = `${APP_BASE_URL}/api/integrations/qbo/callback`;

export async function GET(request: Request) {
  try {
    const tenantId = getTenantIdFromRequest(request);
    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized: Tenant ID missing.' }, { status: 401 });
    }

    const clientId = await getAppSecret('QBO_CLIENT_ID');
    if (!clientId || clientId === 'YOUR_QBO_CLIENT_ID_PLACEHOLDER') {
      console.error('QBO Client ID is not configured.');
      return NextResponse.json({ error: 'Internal Server Error: QBO integration not configured.' }, { status: 500 });
    }

    // 1. Generate CSRF token
    const csrfToken = crypto.randomBytes(16).toString('hex');

    // 2. Store CSRF token securely (e.g., in session or short-lived cache) associated with tenantId
    await storeCsrfToken(tenantId, csrfToken);

    // 3. Create state parameter (encode tenantId and CSRF token)
    const statePayload = JSON.stringify({ tenantId, csrf: csrfToken });
    const state = Buffer.from(statePayload).toString('base64url');

    // 4. Construct the Intuit Authorization URL
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      scope: QBO_SCOPES,
      redirect_uri: REGISTERED_REDIRECT_URI, // Use the exact registered URI
      state: state,
    });

    const authorizationUrl = `${QBO_AUTH_URL}?${params.toString()}`;

    // 5. Redirect the user
    console.log(`Redirecting user to QBO authorization URL for tenant: ${tenantId}`);
    return NextResponse.redirect(authorizationUrl, 302);

  } catch (error) {
    console.error('Error initiating QBO OAuth flow:', error);
    // TODO: Redirect to an error page in the UI?
    // For now, return a generic server error.
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}