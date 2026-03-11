import type { ReactElement } from 'react';

export const CALENDAR_UNAVAILABLE_ERROR = 'Calendar is not available through @enterprise compatibility stubs.';

export async function unavailableCalendarResponse(): Promise<Response> {
  return new Response(CALENDAR_UNAVAILABLE_ERROR, { status: 404 });
}

export function CalendarIntegrationsSettings(): ReactElement | null {
  return null;
}

export function CalendarProfileSettings(): ReactElement | null {
  return null;
}

export class CalendarProviderService {}
export class CalendarSyncService {}
export class CalendarWebhookMaintenanceService {}
export class CalendarWebhookProcessor {}
export class GoogleCalendarAdapter {}
export class MicrosoftCalendarAdapter {}
export class BaseCalendarAdapter {}

export async function initiateCalendarOAuth(..._args: unknown[]) {
  return { success: false, error: CALENDAR_UNAVAILABLE_ERROR };
}

export async function getCalendarProviders(..._args: unknown[]) {
  return { success: false, error: CALENDAR_UNAVAILABLE_ERROR, providers: [] };
}

export async function createCalendarProvider(..._args: unknown[]) {
  return { success: false, error: CALENDAR_UNAVAILABLE_ERROR };
}

export async function updateCalendarProvider(..._args: unknown[]) {
  return { success: false, error: CALENDAR_UNAVAILABLE_ERROR };
}

export async function deleteCalendarProvider(..._args: unknown[]) {
  return { success: false, error: CALENDAR_UNAVAILABLE_ERROR };
}

export async function syncScheduleEntryToCalendar(..._args: unknown[]) {
  return { success: false, error: CALENDAR_UNAVAILABLE_ERROR };
}

export async function syncExternalEventToSchedule(..._args: unknown[]) {
  return { success: false, error: CALENDAR_UNAVAILABLE_ERROR };
}

export async function resolveCalendarConflict(..._args: unknown[]) {
  return { success: false, error: CALENDAR_UNAVAILABLE_ERROR };
}

export async function getScheduleEntrySyncStatus(..._args: unknown[]) {
  return { success: false, error: CALENDAR_UNAVAILABLE_ERROR, status: [] };
}

export async function syncCalendarProvider(..._args: unknown[]) {
  return { success: false, error: CALENDAR_UNAVAILABLE_ERROR };
}

export async function retryMicrosoftCalendarSubscriptionRenewal(..._args: unknown[]) {
  return { success: false, error: CALENDAR_UNAVAILABLE_ERROR };
}

export async function registerCalendarSyncSubscriber(): Promise<void> {}
export async function unregisterCalendarSyncSubscriber(): Promise<void> {}
export async function renewMicrosoftCalendarWebhooks(): Promise<void> {}
export async function verifyGoogleCalendarProvisioning(): Promise<void> {}
