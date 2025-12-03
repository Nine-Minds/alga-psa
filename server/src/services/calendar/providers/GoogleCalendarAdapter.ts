import axios, { AxiosInstance } from 'axios';
import { BaseCalendarAdapter } from './base/BaseCalendarAdapter';
import { CalendarProviderConfig, ExternalCalendarEvent } from '../../../interfaces/calendar.interfaces';
import { getSecretProviderInstance } from '@alga-psa/shared/core';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { CalendarProviderService } from '../CalendarProviderService';
import { getWebhookBaseUrl } from '../../../utils/email/webhookHelpers';

/**
 * Google Calendar API adapter for calendar synchronization
 * Handles OAuth authentication, Pub/Sub subscriptions, and event management
 */
export class GoogleCalendarAdapter extends BaseCalendarAdapter {
  private httpClient: AxiosInstance;
  private baseUrl = 'https://www.googleapis.com/calendar/v3';
  private oauth2Client: OAuth2Client;
  private calendar: any;
  private calendarId: string;
  
  constructor(config: CalendarProviderConfig) {
    super(config);
    
    // Get calendar ID from config
    this.calendarId = config.calendar_id || 'primary';
    
    // Create axios instance with default headers
    this.httpClient = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    // Initialize OAuth2 client (will be configured with credentials later)
    this.oauth2Client = new OAuth2Client();
    this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });

    // Add request interceptor to include auth token
    this.httpClient.interceptors.request.use(async (config) => {
      await this.ensureValidToken();
      if (this.accessToken) {
        config.headers.Authorization = `Bearer ${this.accessToken}`;
      }
      return config;
    });
  }

  /**
   * Load stored credentials from the provider configuration
   */
  protected async loadCredentials(): Promise<void> {
    try {
      const vendorConfig = this.config.provider_config || {};

      // Check if OAuth tokens are available in provider config
      if (!vendorConfig.accessToken || !vendorConfig.refreshToken) {
        throw new Error('OAuth tokens not found in provider configuration. Please complete OAuth authorization.');
      }

      this.accessToken = vendorConfig.accessToken;
      this.refreshToken = vendorConfig.refreshToken;
      this.tokenExpiresAt = vendorConfig.tokenExpiresAt ? new Date(vendorConfig.tokenExpiresAt) : new Date();

      // Configure OAuth2 client with stored credentials
      this.oauth2Client.setCredentials({
        access_token: this.accessToken,
        refresh_token: this.refreshToken,
        token_type: 'Bearer',
        expiry_date: this.tokenExpiresAt.getTime()
      });

      this.log('info', 'Credentials loaded successfully from provider configuration');
    } catch (error) {
      throw this.handleError(error, 'loadCredentials');
    }
  }

  /**
   * Refresh the access token using Google OAuth
   */
  protected async refreshAccessToken(): Promise<void> {
    try {
      if (!this.refreshToken) {
        throw new Error('No refresh token available');
      }

      const vendorConfig = this.config.provider_config || {};
      
      // Get client credentials from provider config, environment, or tenant secrets
      let clientId = vendorConfig.clientId || process.env.GOOGLE_CALENDAR_CLIENT_ID;
      let clientSecret = vendorConfig.clientSecret || process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
      
      // Fall back to tenant secrets if not found in config or environment
      if (!clientId || !clientSecret) {
        const secretProvider = await getSecretProviderInstance();
        clientId = clientId || await secretProvider.getTenantSecret(this.config.tenant, 'google_calendar_client_id');
        clientSecret = clientSecret || await secretProvider.getTenantSecret(this.config.tenant, 'google_calendar_client_secret');
      }

      if (!clientId || !clientSecret) {
        throw new Error('Google OAuth credentials not configured');
      }

      // Configure OAuth2 client with app credentials
      this.oauth2Client = new OAuth2Client(clientId, clientSecret);
      this.oauth2Client.setCredentials({
        refresh_token: this.refreshToken
      });

      // Get new access token
      const { credentials } = await this.oauth2Client.refreshAccessToken();
      
      if (!credentials.access_token) {
        throw new Error('Failed to obtain new access token');
      }

      this.accessToken = credentials.access_token;
      if (credentials.refresh_token) {
        this.refreshToken = credentials.refresh_token;
      }

      // Calculate expiry with 5-minute buffer
      const expiryTime = credentials.expiry_date 
        ? new Date(credentials.expiry_date - 300000) 
        : new Date(Date.now() + 3300000); // Default to 55 minutes
      
      this.tokenExpiresAt = expiryTime;

      // Update stored credentials
      await this.updateStoredCredentials();

      // Update calendar client
      this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });

      this.log('info', 'Access token refreshed successfully');
    } catch (error) {
      throw this.handleError(error, 'refreshAccessToken');
    }
  }

  /**
   * Update stored credentials with new tokens
   */
  private async updateStoredCredentials(): Promise<void> {
    try {
      // Update the provider config with new tokens
      if (this.config.provider_config) {
        this.config.provider_config.accessToken = this.accessToken;
        this.config.provider_config.refreshToken = this.refreshToken;
        this.config.provider_config.tokenExpiresAt = this.tokenExpiresAt?.toISOString();
      }
      
      // Persist to database using provider service to ensure encryption rules apply
      const providerService = new CalendarProviderService();
      await providerService.updateProvider(this.config.id, this.config.tenant, {
        vendorConfig: {
          accessToken: this.accessToken,
          refreshToken: this.refreshToken,
          tokenExpiresAt: this.tokenExpiresAt?.toISOString() || null
        }
      });
    } catch (error) {
      this.log('warn', 'Failed to update stored credentials', error);
      // Don't throw - credential refresh was successful, DB update failure is not critical
    }
  }

  /**
   * Connect to Google Calendar and authenticate
   */
  async connect(): Promise<void> {
    try {
      await this.ensureValidToken();
      this.log('info', 'Connected to Google Calendar successfully');
    } catch (error) {
      throw this.handleError(error, 'connect');
    }
  }

  /**
   * Create an event in Google Calendar
   */
  async createEvent(event: ExternalCalendarEvent): Promise<ExternalCalendarEvent> {
    try {
      await this.ensureValidToken();

      const eventData: any = {
        summary: event.title,
        description: event.description || '',
        start: event.start,
        end: event.end,
        location: event.location || '',
        status: event.status || 'confirmed',
        visibility: event.visibility || 'default',
      };

      // Add attendees if provided
      if (event.attendees && event.attendees.length > 0) {
        eventData.attendees = event.attendees.map(attendee => ({
          email: attendee.email,
          displayName: attendee.name,
          responseStatus: attendee.responseStatus || 'needsAction'
        }));
      }

      // Add recurrence if provided
      if (event.recurrence && event.recurrence.length > 0) {
        eventData.recurrence = event.recurrence;
      }

      // Add reminders
      if (event.reminders) {
        eventData.reminders = event.reminders;
      }

      // Add extended properties for tracking
      if (event.extendedProperties) {
        eventData.extendedProperties = event.extendedProperties;
      }

      const response = await this.calendar.events.insert({
        calendarId: this.calendarId,
        requestBody: eventData
      });

      const createdEvent = response.data;
      return this.mapGoogleEventToExternal(createdEvent);
    } catch (error) {
      throw this.handleError(error, 'createEvent');
    }
  }

  /**
   * Update an event in Google Calendar
   */
  async updateEvent(eventId: string, event: Partial<ExternalCalendarEvent>): Promise<ExternalCalendarEvent> {
    try {
      await this.ensureValidToken();

      // First, get the existing event
      const existing = await this.calendar.events.get({
        calendarId: this.calendarId,
        eventId: eventId
      });

      const existingEvent = existing.data;
      const updateData: any = {};

      if (event.title !== undefined) updateData.summary = event.title;
      if (event.description !== undefined) updateData.description = event.description || '';
      if (event.start !== undefined) updateData.start = event.start;
      if (event.end !== undefined) updateData.end = event.end;
      if (event.location !== undefined) updateData.location = event.location || '';
      if (event.status !== undefined) updateData.status = event.status;
      if (event.visibility !== undefined) updateData.visibility = event.visibility;

      if (event.attendees !== undefined) {
        updateData.attendees = event.attendees.map(attendee => ({
          email: attendee.email,
          displayName: attendee.name,
          responseStatus: attendee.responseStatus || 'needsAction'
        }));
      }

      if (event.recurrence !== undefined) {
        updateData.recurrence = event.recurrence;
      }

      if (event.reminders !== undefined) {
        updateData.reminders = event.reminders;
      }

      if (event.extendedProperties !== undefined) {
        updateData.extendedProperties = event.extendedProperties;
      }

      // Merge with existing event data
      const mergedEvent = { ...existingEvent, ...updateData };

      const response = await this.calendar.events.update({
        calendarId: this.calendarId,
        eventId: eventId,
        requestBody: mergedEvent
      });

      return this.mapGoogleEventToExternal(response.data);
    } catch (error) {
      throw this.handleError(error, 'updateEvent');
    }
  }

  /**
   * Delete an event from Google Calendar
   */
  async deleteEvent(eventId: string): Promise<void> {
    try {
      await this.ensureValidToken();

      await this.calendar.events.delete({
        calendarId: this.calendarId,
        eventId: eventId
      });

      this.log('info', `Deleted event ${eventId} from Google Calendar`);
    } catch (error) {
      throw this.handleError(error, 'deleteEvent');
    }
  }

  /**
   * Get event details from Google Calendar
   */
  async getEvent(eventId: string): Promise<ExternalCalendarEvent> {
    try {
      await this.ensureValidToken();

      const response = await this.calendar.events.get({
        calendarId: this.calendarId,
        eventId: eventId
      });

      return this.mapGoogleEventToExternal(response.data);
    } catch (error: any) {
      // Handle 404 quietly - this is expected when events are deleted
      const status = error?.response?.status || error?.code;
      if (status === 404) {
        const notFoundError = new Error('Event not found');
        (notFoundError as any).status = 404;
        (notFoundError as any).code = 404;
        throw notFoundError;
      }
      throw this.handleError(error, 'getEvent');
    }
  }

  /**
   * List events in a date range
   */
  async listEvents(startDate: Date, endDate: Date): Promise<ExternalCalendarEvent[]> {
    try {
      await this.ensureValidToken();

      const response = await this.calendar.events.list({
        calendarId: this.calendarId,
        timeMin: startDate.toISOString(),
        timeMax: endDate.toISOString(),
        singleEvents: true,
        orderBy: 'startTime'
      });

      const events = response.data.items || [];
      return events.map((event: any) => this.mapGoogleEventToExternal(event));
    } catch (error) {
      throw this.handleError(error, 'listEvents');
    }
  }

  /**
   * Fetch incremental event changes using Google sync tokens.
   */
  async fetchEventChanges(params: {
    syncToken?: string | null;
    timeMin?: Date;
  }): Promise<{
    changes: Array<{ id: string; changeType: 'updated' | 'deleted' }>;
    nextSyncToken?: string;
    resetRequired?: boolean;
  }> {
    await this.ensureValidToken();

    const changes: Array<{ id: string; changeType: 'updated' | 'deleted' }> = [];
    let nextSyncToken: string | undefined;
    let pageToken: string | undefined;

    const request: any = {
      calendarId: this.calendarId,
      singleEvents: true,
      showDeleted: true,
      maxResults: 2500
    };

    if (params.syncToken) {
      request.syncToken = params.syncToken;
    } else {
      const start = params.timeMin ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
      request.timeMin = start.toISOString();
      request.timeMax = new Date().toISOString();
    }

    do {
      if (pageToken) {
        request.pageToken = pageToken;
      }

      let response;
      try {
        response = await this.calendar.events.list(request);
      } catch (error) {
        if (this.isSyncTokenInvalidError(error)) {
          return { changes, resetRequired: true };
        }
        throw this.handleError(error, 'fetchEventChanges');
      }

      const items = response.data.items || [];
      for (const item of items) {
        if (!item?.id) {
          continue;
        }

        const status = typeof item.status === 'string' ? item.status.toLowerCase() : '';
        const changeType: 'updated' | 'deleted' = status === 'cancelled' ? 'deleted' : 'updated';
        changes.push({ id: item.id, changeType });
      }

      pageToken = response.data.nextPageToken || undefined;
      if (response.data.nextSyncToken) {
        nextSyncToken = response.data.nextSyncToken;
      }
    } while (pageToken);

    return { changes, nextSyncToken };
  }

  /**
   * Register webhook subscription for calendar change notifications
   */
  async registerWebhookSubscription(): Promise<void> {
    try {
      await this.ensureValidToken();

      const vendorConfig = this.config.provider_config || {};
      // Use dynamic URL resolution (checks ngrok file in development mode)
      const baseUrl = getWebhookBaseUrl([
        'CALENDAR_WEBHOOK_BASE_URL',
        'GOOGLE_CALENDAR_WEBHOOK_BASE_URL',
        'NGROK_URL',
        'NEXT_PUBLIC_BASE_URL',
        'NEXTAUTH_URL'
      ]);
      const webhookUrl = vendorConfig.webhookNotificationUrl || 
        `${baseUrl}/api/calendar/webhooks/google`;

      // Google Calendar uses push notifications via Pub/Sub
      // The Pub/Sub setup should be done separately (similar to Gmail)
      // This method just ensures the calendar is ready to receive notifications
      
      this.log('info', 'Webhook subscription registration completed (Pub/Sub setup required separately)');
    } catch (error) {
      throw this.handleError(error, 'registerWebhookSubscription');
    }
  }

  /**
   * Renew webhook subscription
   */
  async renewWebhookSubscription(): Promise<void> {
    // Google Calendar webhooks don't expire like Microsoft subscriptions
    // But we can verify the Pub/Sub subscription is still active
    this.log('info', 'Webhook subscription renewal not required for Google Calendar');
  }

  /**
   * Process webhook notification and return changed event IDs
   */
  async processWebhookNotification(payload: any): Promise<string[]> {
    try {
      // Google Calendar sends Pub/Sub messages
      // The payload structure is similar to Gmail webhooks
      const eventIds: string[] = [];

      if (payload.message?.data) {
        const messageData = JSON.parse(Buffer.from(payload.message.data, 'base64').toString());
        
        // Google Calendar push notifications include resource state
        // We need to query the calendar for changes since the last sync
        if (messageData.resourceState) {
          // For now, return empty array - the webhook processor will handle fetching changes
          // This is because Google Calendar doesn't directly tell us which events changed
          return [];
        }
      }

      return eventIds;
    } catch (error) {
      throw this.handleError(error, 'processWebhookNotification');
    }
  }

  /**
   * Test connection to Google Calendar
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.ensureValidToken();
      
      // Try to get calendar metadata
      await this.calendar.calendars.get({
        calendarId: this.calendarId
      });

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to connect to Google Calendar'
      };
    }
  }

  /**
   * Disconnect from Google Calendar
   */
  async disconnect(): Promise<void> {
    // Google Calendar doesn't require explicit disconnection
    this.log('info', 'Disconnected from Google Calendar');
  }

  /**
   * Get list of available calendars for the authenticated user
   */
  async listCalendars(): Promise<Array<{ id: string; name: string; primary?: boolean }>> {
    try {
      await this.ensureValidToken();

      const response = await this.calendar.calendarList.list();
      const calendars = response.data.items || [];

      return calendars.map((cal: any) => ({
        id: cal.id,
        name: cal.summary || cal.id,
        primary: cal.primary || false
      }));
    } catch (error) {
      throw this.handleError(error, 'listCalendars');
    }
  }

  private isSyncTokenInvalidError(error: any): boolean {
    const code = error?.code || error?.response?.status;
    if (code === 410) {
      return true;
    }

    const status = error?.response?.data?.error?.status;
    return typeof status === 'string' && status.toUpperCase() === 'GONE';
  }

  /**
   * Map Google Calendar event to ExternalCalendarEvent format
   */
  private mapGoogleEventToExternal(event: any): ExternalCalendarEvent {
    return {
      id: event.id,
      provider: 'google',
      title: event.summary || '',
      description: event.description || '',
      start: event.start,
      end: event.end,
      location: event.location || '',
      attendees: event.attendees?.map((a: any) => ({
        email: a.email,
        name: a.displayName,
        responseStatus: a.responseStatus
      })),
      recurrence: event.recurrence,
      status: event.status,
      htmlLink: event.htmlLink,
      iCalUID: event.iCalUID,
      created: event.created,
      updated: event.updated,
      organizer: event.organizer ? {
        email: event.organizer.email,
        name: event.organizer.displayName
      } : undefined,
      reminders: event.reminders,
      visibility: event.visibility,
      extendedProperties: event.extendedProperties
    };
  }
}
