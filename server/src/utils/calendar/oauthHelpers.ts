/**
 * OAuth Helper Functions for Calendar Providers
 */

import { randomBytes } from 'crypto';
import { MICROSOFT_CALENDAR_OAUTH_SCOPES } from '@alga-psa/shared/services/email/microsoftGraphEndpoints';
import { CalendarOAuthState } from '../../interfaces/calendar.interfaces';

/**
 * Generate OAuth authorization URL for Google Calendar
 */
export async function generateGoogleCalendarAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  projectId?: string;
}): Promise<string> {
  const queryParams = new URLSearchParams({
    client_id: params.clientId,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar',
    redirect_uri: params.redirectUri,
    state: params.state,
    access_type: 'offline',
    prompt: 'consent' // Force consent to ensure we get refresh token
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${queryParams.toString()}`;
}

/**
 * Generate OAuth authorization URL for Microsoft Calendar
 */
export async function generateMicrosoftCalendarAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  tenantId?: string;
}): Promise<string> {
  // LEVERAGE: pattern calendar-oauth-helpers-copies — this file exists in three copies (ee/packages/calendar, packages/integrations, server); the scope list is shared, the URL builder is not.
  const scopes = MICROSOFT_CALENDAR_OAUTH_SCOPES.join(' ');

  const queryParams = new URLSearchParams({
    client_id: params.clientId,
    response_type: 'code',
    scope: scopes,
    redirect_uri: params.redirectUri,
    state: params.state,
    prompt: 'select_account'
  });

  const tenant = params.tenantId || 'common';
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${queryParams.toString()}`;
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
