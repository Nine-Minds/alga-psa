/**
 * OAuth Helper Functions for Email Providers
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
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
  purpose?: 'reconnect';
}

export type ImapOAuthState = OAuthState & {
  userId: string;
  providerId: string;
  purpose: 'reconnect';
};

export function encodeImapOAuthState(state: ImapOAuthState, signingKey: string | null | undefined): string {
  if (!signingKey) throw new Error('OAUTH_STATE_SIGNING_KEY is not configured');
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url');
  const signature = createHmac('sha256', signingKey).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function decodeImapOAuthState(token: string, signingKey: string | null | undefined): ImapOAuthState | null {
  if (!signingKey || typeof token !== 'string') return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const expected = createHmac('sha256', signingKey).update(parts[0]).digest();
    const actual = Buffer.from(parts[1], 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const value = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as Partial<ImapOAuthState>;
    if (typeof value.tenant !== 'string' || typeof value.userId !== 'string' ||
        typeof value.providerId !== 'string' || typeof value.redirectUri !== 'string' ||
        typeof value.nonce !== 'string' || value.purpose !== 'reconnect' ||
        typeof value.timestamp !== 'number' || !Number.isFinite(value.timestamp)) return null;
    return value as ImapOAuthState;
  } catch {
    return null;
  }
}

/**
 * Generate OAuth authorization URL for Microsoft
 * Requests inbound read access and Mail.Send for the same configured mailbox.
 */
export function generateMicrosoftAuthUrl(
  clientId: string,
  redirectUri: string,
  state: OAuthState,
  scopes: string[] = [...MICROSOFT_EMAIL_OAUTH_SCOPES],
  tenantAuthority: string = 'common'
): string {
  const baseUrl = getMicrosoftAuthorizeUrl(tenantAuthority);
  
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: scopes.join(' '),
    state: encodeState(state),
    prompt: 'select_account' // Select an account without forcing consent; offline_access requests a refresh token.
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
  if (age < 0 || age > maxAgeMs) {
    console.error('OAuth state expired:', age, 'ms old');
    return false;
  }

  // Additional validation can be added here
  // e.g., checking nonce against stored values, verifying tenant, etc.

  return true;
}
