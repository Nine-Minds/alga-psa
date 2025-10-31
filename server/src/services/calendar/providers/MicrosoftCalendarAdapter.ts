import axios, { AxiosInstance } from 'axios';
import { BaseCalendarAdapter } from './base/BaseCalendarAdapter';
import { CalendarProviderConfig, ExternalCalendarEvent } from '../../../interfaces/calendar.interfaces';
import { getSecretProviderInstance } from '@alga-psa/shared/core';
import { CalendarProviderService } from '../CalendarProviderService';

/**
 * Microsoft Graph API adapter for calendar synchronization
 * Handles OAuth authentication, webhook subscriptions, and event management
 */
export class MicrosoftCalendarAdapter extends BaseCalendarAdapter {
  private httpClient: AxiosInstance;
  private baseUrl = 'https://graph.microsoft.com/v1.0';
  private authenticatedUserEmail: string | undefined;
  private calendarId: string;

  constructor(config: CalendarProviderConfig) {
    super(config);

    // Get calendar ID from config
    this.calendarId = config.calendar_id || 'calendar';

    // Create axios instance with default headers
    this.httpClient = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

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
   * Build Microsoft Graph base path for the configured calendar
   */
  private getCalendarBasePath(): string {
    const configuredCalendarId = (this.calendarId || '').trim();

    // If no calendar ID configured or it's 'calendar', use /me/calendar
    if (!configuredCalendarId || configuredCalendarId === 'calendar') {
      return '/me/calendar';
    }

    // If we have the authenticated user's email, check if this is their calendar
    if (this.authenticatedUserEmail) {
      // For now, assume all calendars use /me/calendar unless explicitly specified
      // In the future, we could support /users/{userId}/calendars/{calendarId}
      return '/me/calendar';
    }

    // Fallback: use /me/calendar
    return '/me/calendar';
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

      this.log('info', 'Loaded Microsoft OAuth credentials from provider configuration');
    } catch (error) {
      throw this.handleError(error, 'loadCredentials');
    }
  }

  /**
   * Fetch the authenticated user's email address from /me endpoint
   */
  private async loadAuthenticatedUserEmail(): Promise<void> {
    try {
      const response = await this.httpClient.get('/me', {
        params: {
          $select: 'userPrincipalName,mail'
        }
      });

      this.authenticatedUserEmail = response.data.userPrincipalName || response.data.mail;

      if (this.authenticatedUserEmail) {
        this.log('info', 'Loaded authenticated user email', {
          email: this.authenticatedUserEmail
        });
      }
    } catch (error) {
      this.log('warn', 'Failed to load authenticated user email', error);
    }
  }

  /**
   * Refresh the access token using Microsoft OAuth
   */
  protected async refreshAccessToken(): Promise<void> {
    try {
      if (!this.refreshToken) {
        throw new Error('No refresh token available');
      }

      const vendorConfig = this.config.provider_config || {};

      // Prefer env or provider_config, then fallback to tenant secrets
      let clientId = vendorConfig.clientId || process.env.MICROSOFT_CLIENT_ID;
      let clientSecret = vendorConfig.clientSecret || process.env.MICROSOFT_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        const secretProvider = await getSecretProviderInstance();
        clientId = clientId || (await secretProvider.getTenantSecret(this.config.tenant, 'microsoft_client_id'));
        clientSecret = clientSecret || (await secretProvider.getTenantSecret(this.config.tenant, 'microsoft_client_secret'));
      }

      if (!clientId || !clientSecret) {
        throw new Error('Microsoft OAuth credentials not configured');
      }

      // Determine tenant authority
      const vendorTenantId = vendorConfig.tenantId;
      let tenantAuthority = vendorTenantId || process.env.MICROSOFT_TENANT_ID || 'common';

      const tokenUrl = `https://login.microsoftonline.com/${tenantAuthority}/oauth2/v2.0/token`;

      const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token',
        scope: 'https://graph.microsoft.com/Calendars.ReadWrite offline_access'
      });

      const response = await axios.post(tokenUrl, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const { access_token, refresh_token, expires_in } = response.data;

      if (!access_token) {
        throw new Error('Failed to obtain new access token');
      }

      this.accessToken = access_token;
      if (refresh_token) {
        this.refreshToken = refresh_token;
      }

      // Calculate expiry with 5-minute buffer
      const expiryTime = new Date(Date.now() + (expires_in - 300) * 1000);
      this.tokenExpiresAt = expiryTime;

      // Update stored credentials
      await this.updateStoredCredentials();

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
      
      // Persist to database via provider service to ensure encryption rules apply
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
    }
  }

  /**
   * Connect to Microsoft Calendar and authenticate
   */
  async connect(): Promise<void> {
    try {
      await this.ensureValidToken();
      await this.loadAuthenticatedUserEmail();
      this.log('info', 'Connected to Microsoft Calendar successfully');
    } catch (error) {
      throw this.handleError(error, 'connect');
    }
  }

  /**
   * Create an event in Microsoft Calendar
   */
  async createEvent(event: ExternalCalendarEvent): Promise<ExternalCalendarEvent> {
    try {
      await this.ensureValidToken();

      const calendarBase = this.getCalendarBasePath();
      const eventData: any = {
        subject: event.title,
        body: {
          contentType: 'HTML',
          content: event.description || ''
        },
        start: event.start,
        end: event.end,
        location: event.location ? {
          displayName: event.location
        } : undefined,
        isAllDay: !event.start.dateTime && !!event.start.date,
        showAs: event.status === 'cancelled' ? 'free' : 'busy',
        sensitivity: event.visibility === 'private' ? 'private' : 'normal'
      };

      // Add attendees if provided
      if (event.attendees && event.attendees.length > 0) {
        eventData.attendees = event.attendees.map(attendee => ({
          emailAddress: {
            address: attendee.email,
            name: attendee.name
          },
          type: 'required',
          status: {
            response: attendee.responseStatus === 'accepted' ? 'accepted' :
                     attendee.responseStatus === 'declined' ? 'declined' :
                     attendee.responseStatus === 'tentative' ? 'tentative' : 'none'
          }
        }));
      }

      // Add recurrence if provided
      if (event.recurrence && event.recurrence.length > 0) {
        // Microsoft Graph uses a different recurrence format
        // For now, store RRULE in a single recurrencePattern property
        eventData.recurrence = {
          pattern: {
            type: 'daily', // Will be parsed from RRULE
            interval: 1
          },
          range: {
            type: 'noEnd',
            startDate: event.start.dateTime || event.start.date
          }
        };
        // Store original RRULE in extended properties
        eventData.singleValueExtendedProperties = [{
          id: 'String {66f5a359-4659-4830-9070-00047ec6ac6e} Name AlgaRRULE',
          value: event.recurrence[0]
        }];
      }

      // Add extended properties for tracking
      if (event.extendedProperties) {
        if (event.extendedProperties.private) {
          eventData.singleValueExtendedProperties = [
            ...(eventData.singleValueExtendedProperties || []),
            ...Object.entries(event.extendedProperties.private).map(([key, value]) => ({
              id: `String {66f5a359-4659-4830-9070-00047ec6ac6e} Name ${key}`,
              value
            }))
          ];
        }
      }

      const response = await this.httpClient.post(`${calendarBase}/events`, eventData);

      return this.mapMicrosoftEventToExternal(response.data);
    } catch (error) {
      throw this.handleError(error, 'createEvent');
    }
  }

  /**
   * Update an event in Microsoft Calendar
   */
  async updateEvent(eventId: string, event: Partial<ExternalCalendarEvent>): Promise<ExternalCalendarEvent> {
    try {
      await this.ensureValidToken();

      const calendarBase = this.getCalendarBasePath();
      const updateData: any = {};

      if (event.title !== undefined) updateData.subject = event.title;
      if (event.description !== undefined) {
        updateData.body = {
          contentType: 'HTML',
          content: event.description || ''
        };
      }
      if (event.start !== undefined) updateData.start = event.start;
      if (event.end !== undefined) updateData.end = event.end;
      if (event.location !== undefined) {
        updateData.location = event.location ? {
          displayName: event.location
        } : undefined;
      }
      if (event.status !== undefined) {
        updateData.showAs = event.status === 'cancelled' ? 'free' : 'busy';
      }
      if (event.visibility !== undefined) {
        updateData.sensitivity = event.visibility === 'private' ? 'private' : 'normal';
      }

      if (event.attendees !== undefined) {
        updateData.attendees = event.attendees.map(attendee => ({
          emailAddress: {
            address: attendee.email,
            name: attendee.name
          },
          type: 'required',
          status: {
            response: attendee.responseStatus === 'accepted' ? 'accepted' :
                     attendee.responseStatus === 'declined' ? 'declined' :
                     attendee.responseStatus === 'tentative' ? 'tentative' : 'none'
          }
        }));
      }

      if (event.recurrence !== undefined && event.recurrence.length > 0) {
        // Similar to createEvent, store RRULE in extended properties
        updateData.singleValueExtendedProperties = [{
          id: 'String {66f5a359-4659-4830-9070-00047ec6ac6e} Name AlgaRRULE',
          value: event.recurrence[0]
        }];
      }

      const response = await this.httpClient.patch(`${calendarBase}/events/${eventId}`, updateData);

      return this.mapMicrosoftEventToExternal(response.data);
    } catch (error) {
      throw this.handleError(error, 'updateEvent');
    }
  }

  /**
   * Delete an event from Microsoft Calendar
   */
  async deleteEvent(eventId: string): Promise<void> {
    try {
      await this.ensureValidToken();

      const calendarBase = this.getCalendarBasePath();
      await this.httpClient.delete(`${calendarBase}/events/${eventId}`);

      this.log('info', `Deleted event ${eventId} from Microsoft Calendar`);
    } catch (error) {
      throw this.handleError(error, 'deleteEvent');
    }
  }

  /**
   * Get event details from Microsoft Calendar
   */
  async getEvent(eventId: string): Promise<ExternalCalendarEvent> {
    try {
      await this.ensureValidToken();

      const calendarBase = this.getCalendarBasePath();
      const response = await this.httpClient.get(`${calendarBase}/events/${eventId}`);

      return this.mapMicrosoftEventToExternal(response.data);
    } catch (error) {
      throw this.handleError(error, 'getEvent');
    }
  }

  /**
   * List events in a date range
   */
  async listEvents(startDate: Date, endDate: Date): Promise<ExternalCalendarEvent[]> {
    try {
      await this.ensureValidToken();

      const calendarBase = this.getCalendarBasePath();
      const response = await this.httpClient.get(`${calendarBase}/events`, {
        params: {
          $filter: `start/dateTime ge '${startDate.toISOString()}' and end/dateTime le '${endDate.toISOString()}'`,
          $orderby: 'start/dateTime',
          $select: 'id,subject,body,start,end,location,attendees,recurrence,webLink,createdDateTime,lastModifiedDateTime,organizer,isAllDay,sensitivity'
        }
      });

      const events = response.data.value || [];
      return events.map((event: any) => this.mapMicrosoftEventToExternal(event));
    } catch (error) {
      throw this.handleError(error, 'listEvents');
    }
  }

  /**
   * Register webhook subscription for calendar change notifications
   */
  async registerWebhookSubscription(): Promise<void> {
    try {
      await this.ensureValidToken();

      const vendorConfig = this.config.provider_config || {};
      const webhookUrl = vendorConfig.webhookNotificationUrl || 
        `${process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/calendar/webhooks/microsoft`;

      // Microsoft Graph limit for calendar subscriptions is 4230 minutes (~70.5 hours)
      // Use a safe window (e.g., 60 hours) to avoid 400 due to out-of-range expiration
      const expirationMs = 60 * 60 * 1000 * 60; // 60 hours in ms

      const calendarBase = this.getCalendarBasePath();
      const resource = `${calendarBase}/events`;

      const subscription = {
        changeType: 'created,updated,deleted',
        notificationUrl: webhookUrl,
        resource,
        expirationDateTime: new Date(Date.now() + expirationMs).toISOString(),
        clientState: vendorConfig.webhookVerificationToken || 'calendar-webhook-verification',
      };

      const maskedState = subscription.clientState
        ? `${String(subscription.clientState).slice(0, 4)}...(${String(subscription.clientState).length})`
        : 'none';
      this.log('info', 'Creating Microsoft calendar subscription', {
        notificationUrl: subscription.notificationUrl,
        resource: subscription.resource,
        expirationDateTime: subscription.expirationDateTime,
        clientState: maskedState,
      });

      const response = await this.httpClient.post('/subscriptions', subscription);
      
      // Update config with subscription ID
      const subscriptionId = response.data.id;
      const expiresAt = response.data.expirationDateTime;

      // Persist webhook details
      const db = await getAdminConnection();
      await db('microsoft_calendar_provider_config')
        .where('calendar_provider_id', this.config.id)
        .andWhere('tenant', this.config.tenant)
        .update({
          webhook_subscription_id: subscriptionId,
          webhook_expires_at: expiresAt,
          webhook_notification_url: webhookUrl,
          updated_at: db.fn.now()
        });

      this.log('info', 'Webhook subscription registered successfully', {
        subscriptionId,
        expiresAt
      });
    } catch (error) {
      throw this.handleError(error, 'registerWebhookSubscription');
    }
  }

  /**
   * Renew webhook subscription
   */
  async renewWebhookSubscription(): Promise<void> {
    try {
      await this.ensureValidToken();

      const vendorConfig = this.config.provider_config || {};
      const subscriptionId = vendorConfig.webhookSubscriptionId;

      if (!subscriptionId) {
        throw new Error('No webhook subscription ID found');
      }

      // Microsoft Graph limit for calendar subscriptions is 4230 minutes (~70.5 hours)
      const expirationMs = 60 * 60 * 1000 * 60; // 60 hours in ms

      const response = await this.httpClient.patch(`/subscriptions/${subscriptionId}`, {
        expirationDateTime: new Date(Date.now() + expirationMs).toISOString()
      });

      const expiresAt = response.data.expirationDateTime;

      // Update stored expiration
      const db = await getAdminConnection();
      await db('microsoft_calendar_provider_config')
        .where('calendar_provider_id', this.config.id)
        .andWhere('tenant', this.config.tenant)
        .update({
          webhook_expires_at: expiresAt,
          updated_at: db.fn.now()
        });

      this.log('info', 'Webhook subscription renewed successfully', {
        subscriptionId,
        expiresAt
      });
    } catch (error) {
      throw this.handleError(error, 'renewWebhookSubscription');
    }
  }

  /**
   * Fetch incremental event changes via Microsoft Graph delta queries.
   */
  async fetchDeltaChanges(deltaLink?: string | null): Promise<{
    changes: Array<{ id: string; changeType: 'updated' | 'deleted' }>;
    deltaLink?: string;
    resetRequired?: boolean;
  }> {
    await this.ensureValidToken();

    const changes: Array<{ id: string; changeType: 'updated' | 'deleted' }> = [];
    const initialUrl = deltaLink ?? `${this.getCalendarBasePath()}/events/delta`;
    let requestUrl: string | undefined = initialUrl;
    let nextDeltaLink: string | undefined;

    try {
      while (requestUrl) {
        const response = await this.httpClient.get(requestUrl, {
          headers: deltaLink ? {} : { Prefer: 'odata.track-changes' }
        });

        const items = response.data?.value || [];
        for (const item of items) {
          if (!item?.id) {
            continue;
          }
          const changeType: 'updated' | 'deleted' = item['@removed'] ? 'deleted' : 'updated';
          changes.push({ id: item.id, changeType });
        }

        requestUrl = response.data?.['@odata.nextLink'] || undefined;
        if (response.data?.['@odata.deltaLink']) {
          nextDeltaLink = response.data['@odata.deltaLink'];
        }
      }

      return {
        changes,
        deltaLink: nextDeltaLink ?? deltaLink ?? undefined
      };
    } catch (error) {
      if (this.isDeltaLinkInvalidError(error)) {
        return { changes, resetRequired: true };
      }
      throw this.handleError(error, 'fetchDeltaChanges');
    }
  }

  /**
   * Process webhook notification and return changed event IDs
   */
  async processWebhookNotification(payload: any): Promise<string[]> {
    try {
      const eventIds: string[] = [];

      // Microsoft Graph sends notifications in a 'value' array
      if (payload.value && Array.isArray(payload.value)) {
        for (const notification of payload.value) {
          if (notification.resourceData?.id) {
            eventIds.push(notification.resourceData.id);
          } else if (notification.resource) {
            // Extract event ID from resource URL
            const match = notification.resource.match(/\/events\/([^\/]+)/);
            if (match) {
              eventIds.push(match[1]);
            }
          }
        }
      }

      return eventIds;
    } catch (error) {
      throw this.handleError(error, 'processWebhookNotification');
    }
  }

  private isDeltaLinkInvalidError(error: any): boolean {
    const status = error?.response?.status || error?.code;
    if (status === 410) {
      return true;
    }

    const graphError = error?.response?.data?.error;
    const code = graphError?.code || graphError?.innerError?.code;
    if (typeof code === 'string' && code.toLowerCase().includes('syncstatenotfound')) {
      return true;
    }

    return false;
  }

  /**
   * Test connection to Microsoft Calendar
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.ensureValidToken();
      
      // Try to get calendar metadata
      const calendarBase = this.getCalendarBasePath();
      await this.httpClient.get(calendarBase);

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to connect to Microsoft Calendar'
      };
    }
  }

  /**
   * Disconnect from Microsoft Calendar
   */
  async disconnect(): Promise<void> {
    // Microsoft Calendar doesn't require explicit disconnection
    this.log('info', 'Disconnected from Microsoft Calendar');
  }

  /**
   * Get list of available calendars for the authenticated user
   */
  async listCalendars(): Promise<Array<{ id: string; name: string; primary?: boolean }>> {
    try {
      await this.ensureValidToken();

      const response = await this.httpClient.get('/me/calendars');
      const calendars = response.data.value || [];

      return calendars.map((cal: any) => ({
        id: cal.id,
        name: cal.name || cal.id,
        primary: cal.isDefaultCalendar || false
      }));
    } catch (error) {
      throw this.handleError(error, 'listCalendars');
    }
  }

  /**
   * Map Microsoft Calendar event to ExternalCalendarEvent format
   */
  private mapMicrosoftEventToExternal(event: any): ExternalCalendarEvent {
    // Extract RRULE from extended properties if present
    let recurrence: string[] | undefined;
    if (event.singleValueExtendedProperties) {
      const rruleProp = event.singleValueExtendedProperties.find(
        (prop: any) => prop.id?.includes('AlgaRRULE')
      );
      if (rruleProp?.value) {
        recurrence = [rruleProp.value];
      }
    }

    return {
      id: event.id,
      provider: 'microsoft',
      title: event.subject || '',
      description: event.body?.content || '',
      start: {
        dateTime: event.start?.dateTime,
        date: event.start?.date,
        timeZone: event.start?.timeZone
      },
      end: {
        dateTime: event.end?.dateTime,
        date: event.end?.date,
        timeZone: event.end?.timeZone
      },
      location: event.location?.displayName || '',
      attendees: event.attendees?.map((a: any) => ({
        email: a.emailAddress?.address || '',
        name: a.emailAddress?.name,
        responseStatus: a.status?.response === 'accepted' ? 'accepted' :
                       a.status?.response === 'declined' ? 'declined' :
                       a.status?.response === 'tentative' ? 'tentative' : 'needsAction'
      })),
      recurrence,
      status: event.showAs === 'free' ? 'cancelled' : 'confirmed',
      htmlLink: event.webLink,
      created: event.createdDateTime,
      updated: event.lastModifiedDateTime,
      organizer: event.organizer ? {
        email: event.organizer.emailAddress?.address || '',
        name: event.organizer.emailAddress?.name
      } : undefined,
      visibility: event.sensitivity === 'private' ? 'private' : 'default'
    };
  }
}
