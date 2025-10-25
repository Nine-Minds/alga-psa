/**
 * OAuth Helper Functions for Email Providers
 */

import { randomBytes } from 'crypto';

export interface OAuthState {
  tenant: string;
  userId?: string;
  providerId?: string;
  redirectUri: string;
  timestamp: number;
  nonce: string;
  hosted?: boolean; // indicates EE hosted credential flow
}

/**
 * Generate OAuth authorization URL for Microsoft
 * Using read-only scope: Mail.Read for email access
 */
export function generateMicrosoftAuthUrl(
  clientId: string,
  redirectUri: string,
  state: OAuthState,
  scopes: string[] = ['https://graph.microsoft.com/Mail.Read', 'offline_access'],
  tenantAuthority: string = 'common'
): string {
  const baseUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize`;
  
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: scopes.join(' '),
    state: encodeState(state),
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
