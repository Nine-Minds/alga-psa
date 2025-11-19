import { EmailProviderAdapter } from '../../../../interfaces/emailProvider.interface';
import { EmailProviderConfig, EmailMessageDetails } from '../../../../interfaces/inbound-email.interfaces';

/**
 * Base abstract class for email provider adapters
 * Provides common functionality and enforces interface implementation
 */
export abstract class BaseEmailAdapter implements EmailProviderAdapter {
  protected config: EmailProviderConfig;
  protected accessToken?: string;
  protected refreshToken?: string;
  protected tokenExpiresAt?: Date;

  constructor(config: EmailProviderConfig) {
    this.config = config;
  }

  /**
   * Get the current configuration
   */
  getConfig(): EmailProviderConfig {
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
    const logMessage = `[${this.config.provider_type.toUpperCase()}] ${message}`;
    
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
  abstract connect(): Promise<void>;
  abstract registerWebhookSubscription(): Promise<void>;
  abstract renewWebhookSubscription(): Promise<void>;
  abstract processWebhookNotification(payload: any): Promise<string[]>;
  abstract markMessageProcessed(messageId: string): Promise<void>;
  abstract getMessageDetails(messageId: string): Promise<EmailMessageDetails>;
  abstract testConnection(): Promise<{ success: boolean; error?: string; }>;
  abstract disconnect(): Promise<void>;
}
