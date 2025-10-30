/**
 * OAuth Helper Functions for Calendar Providers
 */

import { randomBytes } from 'crypto';
import { CalendarOAuthState } from '../../interfaces/calendar.interfaces';

/**
 * Generate OAuth authorization URL for Google Calendar
 */
export function generateGoogleCalendarAuthUrl(
  clientId: string,
  redirectUri: string,
  state: CalendarOAuthState,
  scopes: string[] = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/pubsub'
  ]
): string {
  const baseUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
  
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
    state: encodeCalendarState(state),
    access_type: 'offline', // Request refresh token
    prompt: 'consent' // Force consent to ensure we get refresh token
  });

  return `${baseUrl}?${params.toString()}`;
}

/**
 * Generate OAuth authorization URL for Microsoft Calendar
 */
export function generateMicrosoftCalendarAuthUrl(
  clientId: string,
  redirectUri: string,
  state: CalendarOAuthState,
  scopes: string[] = [
    'https://graph.microsoft.com/Calendars.ReadWrite',
    'offline_access'
  ],
  tenantAuthority: string = 'common'
): string {
  const baseUrl = `https://login.microsoftonline.com/${tenantAuthority}/oauth2/v2.0/authorize`;
  
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: scopes.join(' '),
    state: encodeCalendarState(state),
    prompt: 'consent' // Force consent to ensure we get refresh token
  });

  return `${baseUrl}?${params.toString()}`;
}

/**
 * Encode calendar state object for OAuth
 */
export function encodeCalendarState(state: CalendarOAuthState): string {
  return Buffer.from(JSON.stringify(state)).toString('base64');
}

/**
 * Decode calendar state from OAuth callback
 */
export function decodeCalendarState(encodedState: string): CalendarOAuthState | null {
  try {
    const decoded = Buffer.from(encodedState, 'base64').toString();
    return JSON.parse(decoded) as CalendarOAuthState;
  } catch (error) {
    console.error('Failed to decode calendar OAuth state:', error);
    return null;
  }
}

/**
 * Generate a secure nonce for OAuth state
 */
export function generateCalendarNonce(): string {
  return randomBytes(16).toString('hex');
}

