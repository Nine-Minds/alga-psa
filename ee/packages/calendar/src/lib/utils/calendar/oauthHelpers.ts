/**
 * OAuth helper functions for calendar providers.
 */

import { randomBytes } from 'crypto';
import type { CalendarOAuthState } from '@alga-psa/types';

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
    prompt: 'consent',
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${queryParams.toString()}`;
}

export async function generateMicrosoftCalendarAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  tenantId?: string;
}): Promise<string> {
  const scopes = [
    'https://graph.microsoft.com/Calendars.ReadWrite',
    'https://graph.microsoft.com/Mail.Read',
    'offline_access',
  ].join(' ');

  const queryParams = new URLSearchParams({
    client_id: params.clientId,
    response_type: 'code',
    scope: scopes,
    redirect_uri: params.redirectUri,
    state: params.state,
    prompt: 'select_account',
  });

  const tenant = params.tenantId || 'common';
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${queryParams.toString()}`;
}

export function encodeCalendarState(state: CalendarOAuthState): string {
  return Buffer.from(JSON.stringify(state)).toString('base64');
}

export function decodeCalendarState(encodedState: string): CalendarOAuthState | null {
  try {
    const decoded = Buffer.from(encodedState, 'base64').toString();
    return JSON.parse(decoded) as CalendarOAuthState;
  } catch (error) {
    console.error('Failed to decode calendar OAuth state:', error);
    return null;
  }
}

export function generateCalendarNonce(): string {
  return randomBytes(16).toString('hex');
}
