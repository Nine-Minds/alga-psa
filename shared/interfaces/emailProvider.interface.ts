import { EmailMessageDetails, EmailProviderConfig } from './inbound-email.interfaces';

/**
 * Base interface for email provider adapters
 * This interface defines the common operations that all email providers must implement
 */
export interface EmailProviderAdapter {
  /**
   * Connect to the email provider using stored credentials
   * This should validate credentials and establish connection
   */
  connect(): Promise<void>;

  /**
   * Set up webhooks for incoming messages
   * This registers a webhook subscription with the email provider
   * to receive notifications when new messages arrive
   */
  registerWebhookSubscription(): Promise<void>;

  /**
   * Renew webhook subscription before expiration
   * Email providers typically require periodic renewal of webhook subscriptions
   */
  renewWebhookSubscription(): Promise<void>;

  /**
   * Process webhook notification data from the email provider
   * This parses the webhook payload and returns message IDs that need processing
   * @param payload - The webhook notification payload from the provider
   * @returns Array of message IDs to process
   */
  processWebhookNotification(payload: any): Promise<string[]>;

  /**
   * Mark a message as read/processed
   * This prevents the same message from being processed multiple times
   * @param messageId - The provider-specific message ID
   */
  markMessageProcessed(messageId: string): Promise<void>;

  /**
   * Get message details including attachments
   * This fetches the full message content from the email provider
   * @param messageId - The provider-specific message ID
   * @returns Complete message details
   */
  getMessageDetails(messageId: string): Promise<EmailMessageDetails>;

  /**
   * Test the connection to the email provider
   * This is used to verify that credentials are still valid
   * @returns Connection status information
   */
  testConnection(): Promise<{
    success: boolean;
    error?: string;
  }>;

  /**
   * Get the current configuration for this adapter
   */
  getConfig(): EmailProviderConfig;

  /**
   * Disconnect and cleanup resources
   * This should revoke tokens and clean up any active connections
   */
  disconnect(): Promise<void>;
}

/**
 * Factory interface for creating email provider adapters
 */
export interface EmailProviderAdapterFactory {
  /**
   * Create an adapter instance for the specified provider type
   * @param config - Provider configuration
   * @returns Adapter instance
   */
  createAdapter(config: EmailProviderConfig): EmailProviderAdapter;

  /**
   * Get supported provider types
   */
  getSupportedProviders(): string[];
}
