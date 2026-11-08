/**
 * Single source of truth for the Microsoft OAuth redirect URIs the Alga
 * integrations use. The routes, the authorize actions and the app-registration
 * guidance UI all build URIs from these helpers so the screen can never list a
 * URI the routes do not actually send (the cause of AADSTS50011).
 *
 * The Entra Direct URI lives in `shared/services/entra/entraCallbackUrl.ts`.
 */

export const MICROSOFT_EMAIL_CALLBACK_PATH = '/api/auth/microsoft/callback';
export const MICROSOFT_EMAIL_SETUP_CALLBACK_PATH = '/api/auth/microsoft/email-setup/callback';
export const MICROSOFT_CALENDAR_CALLBACK_PATH = '/api/auth/microsoft/calendar/callback';

function joinBase(baseUrl: string, path: string): string {
  const trimmed = (baseUrl || '').trim() || 'http://localhost:3000';
  return `${trimmed.replace(/\/+$/, '')}${path}`;
}

export const buildMicrosoftEmailRedirectUri = (baseUrl: string): string =>
  joinBase(baseUrl, MICROSOFT_EMAIL_CALLBACK_PATH);

export const buildMicrosoftEmailSetupRedirectUri = (baseUrl: string): string =>
  joinBase(baseUrl, MICROSOFT_EMAIL_SETUP_CALLBACK_PATH);

export const buildMicrosoftCalendarRedirectUri = (baseUrl: string): string =>
  joinBase(baseUrl, MICROSOFT_CALENDAR_CALLBACK_PATH);
