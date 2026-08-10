/**
 * OAuth Helper Functions for Email Providers
 */

import { randomBytes } from 'crypto';
import {
  getMicrosoftAuthorizeUrl,
  MICROSOFT_EMAIL_OAUTH_SCOPES,
} from '@alga-psa/shared/services/email/microsoftGraphEndpoints';

export interface OAuthState {
  tenant: string;
  userId?: string;
  providerId?: string;
  redirectUri: string;
  timestamp: number;
  nonce: string;
  hosted?: boolean; // indicates EE hosted credential flow
  microsoftCredentialSource?: 'tenant' | 'platform';
}

/**
 * Generate OAuth authorization URL for Microsoft
 * Requests inbound read access and Mail.Send for the same configured mailbox.
 *
 * Pass `encodedState` to supply a pre-signed state string (used by the
 * Microsoft mailbox flow). Otherwise `state` is base64-encoded as before.
 */
export function generateMicrosoftAuthUrl(
  clientId: string,
  redirectUri: string,
  state: OAuthState,
  scopes: string[] = [...MICROSOFT_EMAIL_OAUTH_SCOPES],
  tenantAuthority: string = 'common',
  encodedState?: string
): string {
  const baseUrl = getMicrosoftAuthorizeUrl(tenantAuthority);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: scopes.join(' '),
    state: encodedState ?? encodeState(state),
    prompt: 'consent' // Force consent to ensure we get refresh token
  });

  return `${baseUrl}?${params.toString()}`;
}

/**
 * Generate OAuth authorization URL for Google
 * Using read-only scopes: gmail.readonly for email access
 */
export function generateGoogleAuthUrl(
  clientId: string,
  redirectUri: string,
  state: OAuthState,
  scopes: string[] = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/pubsub'
  ]
): string {
  const baseUrl = 'https://accounts.google.com/o/oauth2/v2/auth';

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
    state: encodeState(state),
    access_type: 'offline', // Request refresh token
    prompt: 'consent' // Force consent to ensure we get refresh token
  });

  return `${baseUrl}?${params.toString()}`;
}

/**
 * Encode state object for OAuth
 */
export function encodeState(state: OAuthState): string {
  return Buffer.from(JSON.stringify(state)).toString('base64');
}

/**
 * Decode state from OAuth callback
 */
export function decodeState(encodedState: string): OAuthState | null {
  try {
    const decoded = Buffer.from(encodedState, 'base64').toString();
    return JSON.parse(decoded) as OAuthState;
  } catch (error) {
    console.error('Failed to decode OAuth state:', error);
    return null;
  }
}

/**
 * Generate a secure nonce for OAuth state
 */
export function generateNonce(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Validate OAuth state to prevent CSRF attacks
 */
export function validateState(state: OAuthState, maxAgeMs: number = 10 * 60 * 1000): boolean {
  // Check if state is expired (default 10 minutes)
  const age = Date.now() - state.timestamp;
  if (age > maxAgeMs) {
    console.error('OAuth state expired:', age, 'ms old');
    return false;
  }

  // Additional validation can be added here
  // e.g., checking nonce against stored values, verifying tenant, etc.

  return true;
}
