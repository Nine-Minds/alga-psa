import { CalendarProviderConfig, ExternalCalendarEvent } from '@/interfaces/calendar.interfaces';
import { IScheduleEntry } from '@/interfaces/schedule.interfaces';

/**
 * Base abstract class for calendar provider adapters
 * Provides common functionality and enforces interface implementation
 */
export abstract class BaseCalendarAdapter {
  protected config: CalendarProviderConfig;
  protected accessToken?: string;
  protected refreshToken?: string;
  protected tokenExpiresAt?: Date;

  constructor(config: CalendarProviderConfig) {
    this.config = config;
  }

  /**
   * Get the current configuration
   */
  getConfig(): CalendarProviderConfig {
    return this.config;
  }

  /**
   * Check if the access token is expired or will expire soon
   * @param bufferMinutes - Minutes of buffer before expiry (default: 5)
   */
  protected isTokenExpired(bufferMinutes: number = 5): boolean {
    if (!this.tokenExpiresAt) return true;
    
    const now = new Date();
    const bufferTime = bufferMinutes * 60 * 1000; // Convert to milliseconds
    return (this.tokenExpiresAt.getTime() - now.getTime()) <= bufferTime;
  }

  /**
   * Load stored credentials from the configuration
   * This should be implemented by each provider to load their specific credential format
   */
  protected abstract loadCredentials(): Promise<void>;

  /**
   * Refresh the access token using the refresh token
   * This should be implemented by each provider using their OAuth flow
   */
  protected abstract refreshAccessToken(): Promise<void>;

  /**
   * Ensure we have a valid access token, refreshing if necessary
   */
  protected async ensureValidToken(): Promise<void> {
    if (!this.accessToken) {
      await this.loadCredentials();
    }

    if (this.isTokenExpired()) {
      await this.refreshAccessToken();
    }
  }

  /**
   * Log messages with provider context
   */
  protected log(level: 'info' | 'warn' | 'error', message: string, data?: any): void {
    const logMessage = `[${this.config.provider_type.toUpperCase()} Calendar] ${message}`;
    
    if (data) {
      console[level](logMessage, data);
    } else {
      console[level](logMessage);
    }
  }

  /**
   * Handle errors consistently across providers
   */
  protected handleError(error: any, context: string): Error {
    // Try to extract helpful details from Axios-style errors
    let details = '';
    const res = error?.response;
    if (res) {
      const err = res.data?.error || res.data;
      const code = err?.code || res.status;
      const message = err?.message || res.statusText;
      const inner = err?.innerError || err?.innererror;
      const reqId = res.headers?.['request-id'] || res.headers?.['client-request-id'];
      details = ` (code: ${code}${reqId ? `, request-id: ${reqId}` : ''}${inner?.dateTime ? `, time: ${inner.dateTime}` : ''})`;
    }

    const errorMessage = `Error in ${context}: ${error.message || error}${details}`;
    this.log('error', errorMessage, error);
    const wrapped = new Error(errorMessage);
    // Propagate metadata for outer catch blocks
    try {
      (wrapped as any).status = res?.status;
      (wrapped as any).code = (res?.data?.error?.code || res?.status) ?? undefined;
      (wrapped as any).requestId = res?.headers?.['request-id'] || res?.headers?.['client-request-id'];
      (wrapped as any).responseBody = res?.data;
    } catch { /* no-op */ }
    return wrapped;
  }

  // Abstract methods that must be implemented by each provider
  
  /**
   * Connect to the calendar provider and authenticate
   */
  abstract connect(): Promise<void>;

  /**
   * Create an event in the external calendar
   */
  abstract createEvent(event: ExternalCalendarEvent): Promise<ExternalCalendarEvent>;

  /**
   * Update an event in the external calendar
   */
  abstract updateEvent(eventId: string, event: Partial<ExternalCalendarEvent>): Promise<ExternalCalendarEvent>;

  /**
   * Delete an event from the external calendar
   */
  abstract deleteEvent(eventId: string): Promise<void>;

  /**
   * Get event details from the external calendar
   */
  abstract getEvent(eventId: string): Promise<ExternalCalendarEvent>;

  /**
   * List events in a date range
   */
  abstract listEvents(startDate: Date, endDate: Date): Promise<ExternalCalendarEvent[]>;

  /**
   * Register webhook subscription for calendar change notifications
   */
  abstract registerWebhookSubscription(): Promise<void>;

  /**
   * Renew webhook subscription (before expiration)
   */
  abstract renewWebhookSubscription(): Promise<void>;

  /**
   * Process webhook notification and return changed event IDs
   */
  abstract processWebhookNotification(payload: any): Promise<string[]>;

  /**
   * Test connection to the calendar provider
   */
  abstract testConnection(): Promise<{ success: boolean; error?: string }>;

  /**
   * Disconnect from the calendar provider
   */
  abstract disconnect(): Promise<void>;

  /**
   * Get list of available calendars for the authenticated user
   */
  abstract listCalendars(): Promise<Array<{ id: string; name: string; primary?: boolean }>>;
}

