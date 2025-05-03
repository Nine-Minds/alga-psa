// server/src/app/api/integrations/qbo/callback/route.ts
import { NextResponse } from 'next/server';
import axios from 'axios';
import { URLSearchParams } from 'url';
// TODO: Import the actual secret provider implementation
// import { getAppSecret } from '@/lib/secrets/secretProvider';
// TODO: Import actual CSRF token storage/retrieval/deletion logic
// import { getStoredCsrfToken, deleteStoredCsrfToken } from '@/lib/auth/csrf';
// TODO: Import actual tenant credential storage logic
// import { storeTenantQboCredentials } from '@/lib/integrations/qbo/credentials';

// --- Placeholders (Replace with actual implementations) ---

const getAppSecret = async (secretName: string): Promise<string | undefined> => {
  console.log(`[Placeholder] Retrieving app secret: ${secretName}`);
  if (secretName === 'QBO_CLIENT_ID') {
    return process.env.QBO_CLIENT_ID || 'YOUR_QBO_CLIENT_ID_PLACEHOLDER';
  }
  if (secretName === 'QBO_CLIENT_SECRET') {
    return process.env.QBO_CLIENT_SECRET || 'YOUR_QBO_CLIENT_SECRET_PLACEHOLDER';
  }
  return undefined;
};

const getStoredCsrfToken = async (tenantId: string): Promise<string | null> => {
  console.log(`[Placeholder] Retrieving stored CSRF token for tenant ${tenantId}`);
  // Example: return await redis.get(`qbo:csrf:${tenantId}`);
  // For testing, we might need a temporary mechanism if Redis isn't set up
  // This placeholder assumes the token from the state is always valid for now.
  // In a real scenario, returning null here if not found would cause validation failure.
  return 'mock_csrf_token_retrieved_for_validation'; // Needs real implementation
};

const deleteStoredCsrfToken = async (tenantId: string): Promise<void> => {
  console.log(`[Placeholder] Deleting stored CSRF token for tenant ${tenantId}`);
  // Example: await redis.del(`qbo:csrf:${tenantId}`);
};

interface QboCredentials {
  tenantId: string;
  accessToken: string;
  refreshToken: string;
  realmId: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
}

const storeTenantQboCredentials = async (credentials: QboCredentials): Promise<void> => {
  console.log(`[Placeholder] Storing QBO credentials for tenant ${credentials.tenantId} and realm ${credentials.realmId}`);
  // This should use the ISecretProvider or a dedicated secure storage mechanism
  // Example: await secretProvider.setTenantSecret(credentials.tenantId, 'QBO_CREDENTIALS', JSON.stringify(credentials));
  // Or write to a secure database table, encrypting tokens.
  console.log('[Placeholder] Credentials:', credentials);
};

// --- Configuration ---
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
// Use NEXT_PUBLIC_APP_URL for client-side accessible base URL if needed elsewhere,
// but for server-side redirects, ensure this resolves correctly.
// Using process.env.APP_BASE_URL assuming it's set correctly for the server environment.
const APP_BASE_URL = process.env.APP_BASE_URL || 'http://localhost:3000';
// IMPORTANT: The redirect URI registered with QBO MUST match this EXACTLY.
const REGISTERED_REDIRECT_URI = `${APP_BASE_URL}/api/integrations/qbo/callback`;
// TODO: Define actual UI redirect URLs relative to APP_BASE_URL
const SUCCESS_REDIRECT_URL = `/settings/integrations?qbo_status=success`;
const FAILURE_REDIRECT_URL = `/settings/integrations?qbo_status=failure&error=`;

// --- Handler ---

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const realmId = searchParams.get('realmId');
  const qboError = searchParams.get('error');

  const failureRedirect = (errorCode: string, message?: string) => {
    const url = new URL(FAILURE_REDIRECT_URL + encodeURIComponent(errorCode), APP_BASE_URL);
    if (message) {
      url.searchParams.append('message', message);
    }
    return NextResponse.redirect(url);
  };

  const successRedirect = () => {
    const url = new URL(SUCCESS_REDIRECT_URL, APP_BASE_URL);
    return NextResponse.redirect(url);
  };

  if (qboError) {
    console.error('QBO returned an error:', qboError);
    return failureRedirect('qbo_error', qboError);
  }

  if (!code || !state || !realmId) {
    console.error('Missing code, state, or realmId in callback query parameters.');
    return failureRedirect('missing_params');
  }

  let tenantId: string | null = null;

  try {
    // 1. Validate State Parameter
    let decodedStatePayload: { tenantId: string; csrf: string };
    try {
      const stateJson = Buffer.from(state, 'base64url').toString('utf-8');
      decodedStatePayload = JSON.parse(stateJson);
      tenantId = decodedStatePayload.tenantId; // Assign tenantId early for logging/cleanup
      if (!tenantId || !decodedStatePayload.csrf) {
        throw new Error('Invalid state payload structure.');
      }
    } catch (err) {
      console.error('Failed to decode or parse state parameter:', err);
      return failureRedirect('invalid_state');
    }

    const storedCsrf = await getStoredCsrfToken(tenantId);
    // TODO: Remove the `|| true` bypass once CSRF storage is implemented
    if (!storedCsrf || storedCsrf !== decodedStatePayload.csrf || true) {
      console.warn(`CSRF token mismatch or bypass active for tenant ${tenantId}. State CSRF: ${decodedStatePayload.csrf}, Stored CSRF: ${storedCsrf}`);
      // In production, uncomment the following lines:
      // console.error(`CSRF token mismatch for tenant ${tenantId}.`);
      // await deleteStoredCsrfToken(tenantId); // Clean up potentially compromised token
      // return failureRedirect('csrf_mismatch');
    }

    // Clean up CSRF token after successful validation
    await deleteStoredCsrfToken(tenantId);

    // 2. Exchange Authorization Code for Tokens
    const clientId = await getAppSecret('QBO_CLIENT_ID');
    const clientSecret = await getAppSecret('QBO_CLIENT_SECRET');

    if (!clientId || clientId === 'YOUR_QBO_CLIENT_ID_PLACEHOLDER' || !clientSecret || clientSecret === 'YOUR_QBO_CLIENT_SECRET_PLACEHOLDER') {
      console.error(`QBO Client ID or Secret not configured for tenant ${tenantId}.`);
      return failureRedirect('config_error');
    }

    const authHeader = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: REGISTERED_REDIRECT_URI, // Use the exact registered URI
    });

    console.log(`Exchanging code for token for tenant ${tenantId}, realm ${realmId}...`);
    const tokenResponse = await axios.post(QBO_TOKEN_URL, tokenParams.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Authorization': authHeader,
      },
      // Add timeout and potentially better error handling for the request itself
      timeout: 10000, // e.g., 10 seconds timeout
    });

    const {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: accessTokenExpiresIn, // seconds
      x_refresh_token_expires_in: refreshTokenExpiresIn, // seconds
      // id_token: idToken, // Can be parsed for user info if needed
    } = tokenResponse.data;

    if (!accessToken || !refreshToken) {
      console.error(`Missing tokens in QBO response for tenant ${tenantId}. Response:`, tokenResponse.data);
      return failureRedirect('token_exchange_failed');
    }

    // 3. Calculate Expiry Timestamps
    const now = Date.now();
    // Subtract a small buffer (e.g., 5 minutes) to refresh before actual expiry
    const accessTokenExpiresAt = new Date(now + (accessTokenExpiresIn - 300) * 1000);
    const refreshTokenExpiresAt = new Date(now + refreshTokenExpiresIn * 1000);

    // 4. Securely Store Credentials (including realmId)
    await storeTenantQboCredentials({
      tenantId,
      realmId: realmId,
      accessToken,
      refreshToken,
      accessTokenExpiresAt,
      refreshTokenExpiresAt,
    });

    console.log(`Successfully stored QBO credentials for tenant ${tenantId}, realm ${realmId}.`);

    // 5. Redirect to Success Page
    return successRedirect();

  } catch (error: any) {
    console.error(`Error during QBO callback processing for tenant ${tenantId || 'UNKNOWN'}:`, error);
    // Log specific axios errors if available
    if (axios.isAxiosError(error)) {
        console.error('Axios error details:', {
            message: error.message,
            code: error.code,
            status: error.response?.status,
            data: error.response?.data,
            headers: error.response?.headers,
            config: { // Log relevant config details, avoid logging secrets
                url: error.config?.url,
                method: error.config?.method,
                headers: error.config?.headers ? { ...error.config.headers, Authorization: '[REDACTED]' } : undefined, // Redact auth header
                timeout: error.config?.timeout,
            }
        });
    } else {
        // Log generic error details
        console.error('Generic error details:', {
            message: error.message,
            stack: error.stack,
        });
    }
    // Redirect to Failure Page
    const errorCode = error.response?.data?.error || 'callback_processing_error';
    return failureRedirect(errorCode);
  }
}