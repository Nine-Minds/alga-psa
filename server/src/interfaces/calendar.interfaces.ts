// Calendar provider interfaces for calendar synchronization

import { IScheduleEntry } from './schedule.interfaces';

export interface CalendarProviderConfig {
  id: string;
  tenant: string;
  user_id: string; // The user who owns this calendar sync
  name: string;
  provider_type: 'google' | 'microsoft';
  calendar_id: string; // External calendar ID
  active: boolean;
  sync_direction: 'bidirectional' | 'to_external' | 'from_external';
  // Connection status fields
  connection_status: 'connected' | 'disconnected' | 'error' | 'configuring';
  last_sync_at?: string; // ISO date
  error_message?: string;
  // Provider-specific configuration
  provider_config?: CalendarProviderVendorConfig;
  created_at: string; // ISO date
  updated_at: string; // ISO date
}

export interface CalendarProviderVendorConfig {
  // Common OAuth settings
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
  redirectUri?: string;
  syncToken?: string;
  deltaLink?: string;
  
  // Google-specific
  projectId?: string;
  pubsubTopicName?: string;
  pubsubSubscriptionName?: string;
  pubsubInitialisedAt?: string;
  
  // Microsoft-specific
  tenantId?: string;
  webhookSubscriptionId?: string;
  webhookExpiresAt?: string;
  
  // Webhook configuration
  webhookNotificationUrl?: string;
  webhookVerificationToken?: string;
}

export interface GoogleCalendarProviderConfig extends CalendarProviderConfig {
  provider_type: 'google';
  provider_config: {
    clientId: string;
    clientSecret: string;
    projectId: string;
    redirectUri: string;
    accessToken?: string;
    refreshToken?: string;
    tokenExpiresAt?: string;
    pubsubTopicName?: string;
    pubsubSubscriptionName?: string;
    pubsubInitialisedAt?: string;
    webhookNotificationUrl?: string;
    webhookVerificationToken?: string;
    calendarId: string;
    syncToken?: string;
  };
}

export interface MicrosoftCalendarProviderConfig extends CalendarProviderConfig {
  provider_type: 'microsoft';
  provider_config: {
    clientId: string;
    clientSecret: string;
    tenantId: string;
    redirectUri: string;
    accessToken?: string;
    refreshToken?: string;
    tokenExpiresAt?: string;
    webhookSubscriptionId?: string;
    webhookExpiresAt?: string;
    webhookNotificationUrl?: string;
    webhookVerificationToken?: string;
    calendarId: string;
    deltaLink?: string;
  };
}

export interface ExternalCalendarEvent {
  id: string;
  provider: 'google' | 'microsoft';
  title: string;
  description?: string;
  start: {
    dateTime?: string; // ISO 8601 for timed events
    date?: string; // YYYY-MM-DD for all-day events
    timeZone?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
    timeZone?: string;
  };
  location?: string;
  attendees?: Array<{
    email: string;
    name?: string;
    responseStatus?: 'needsAction' | 'accepted' | 'declined' | 'tentative';
  }>;
  recurrence?: string[]; // RRULE strings
  status?: 'confirmed' | 'tentative' | 'cancelled';
  htmlLink?: string; // Link to view event in external calendar
  iCalUID?: string; // iCalendar UID
  created?: string; // ISO date
  updated?: string; // ISO date
  organizer?: {
    email: string;
    name?: string;
  };
  reminders?: {
    useDefault?: boolean;
    overrides?: Array<{
      method: 'email' | 'popup';
      minutes: number;
    }>;
  };
  visibility?: 'default' | 'public' | 'private' | 'confidential';
  extendedProperties?: {
    private?: Record<string, string>;
    shared?: Record<string, string>;
  };
}

export interface CalendarEventMapping {
  id: string;
  tenant: string;
  calendar_provider_id: string;
  schedule_entry_id: string;
  external_event_id: string;
  sync_status: 'synced' | 'pending' | 'conflict' | 'error';
  last_synced_at?: string; // ISO date
  sync_error_message?: string;
  sync_direction?: 'to_external' | 'from_external';
  alga_last_modified?: string; // ISO date
  external_last_modified?: string; // ISO date
  created_at: string; // ISO date
  updated_at: string; // ISO date
}

export interface CalendarSyncResult {
  success: boolean;
  mapping?: CalendarEventMapping;
  externalEventId?: string;
  error?: string;
  deleted?: boolean; // True if the entry was deleted (e.g., external event no longer exists)
  skipped?: boolean; // True if sync was skipped (e.g., no @alga marker, or nothing to do)
  reason?: string; // Explanation when deleted or skipped
  conflict?: {
    algaModified: string;
    externalModified: string;
    resolution?: 'alga' | 'external' | 'merge';
  };
}

export interface CalendarSyncStatus {
  providerId: string;
  providerName: string;
  providerType: 'google' | 'microsoft';
  isActive: boolean;
  lastSyncAt?: string;
  syncDirection: 'bidirectional' | 'to_external' | 'from_external';
  errorMessage?: string;
  entrySyncStatus?: {
    entryId: string;
    syncStatus: 'synced' | 'pending' | 'conflict' | 'error';
    externalEventId?: string;
  };
}

export interface CalendarConflictResolution {
  mappingId: string;
  resolution: 'alga' | 'external' | 'merge';
  mergeData?: Partial<IScheduleEntry>;
}

export interface CalendarWebhookNotification {
  provider: 'google' | 'microsoft';
  changeType: 'created' | 'updated' | 'deleted';
  eventId: string;
  calendarId: string;
  resourceState?: string; // For Google - state token
  subscriptionId?: string; // For Microsoft
  clientState?: string; // Verification token
  expirationDateTime?: string; // For Microsoft
}

export interface CalendarOAuthState {
  tenant: string;
  provider: 'google' | 'microsoft';
  calendarProviderId?: string; // For updates
  nonce: string;
  redirectUri?: string;
  timestamp: number;
  hosted?: boolean;
}

export interface CalendarEventCreateRequest {
  scheduleEntry: IScheduleEntry;
  calendarProviderId: string;
  syncDirection?: 'to_external' | 'from_external';
}

export interface CalendarEventUpdateRequest {
  scheduleEntry: Partial<IScheduleEntry>;
  mappingId: string;
  updateType?: 'single' | 'future' | 'all';
}

export interface CalendarEventDeleteRequest {
  mappingId: string;
  deleteType?: 'single' | 'future' | 'all';
}
