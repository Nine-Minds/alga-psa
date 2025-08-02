import axios, { AxiosInstance } from 'axios';
import { BaseEmailAdapter } from './base/BaseEmailAdapter';
import { EmailMessageDetails, EmailProviderConfig } from '../../../interfaces/email.interfaces';
import { getSecretProviderInstance } from '@alga-psa/shared/core';

/**
 * Microsoft Graph API adapter for email processing
 * Handles OAuth authentication, webhook subscriptions, and message retrieval
 */
export class MicrosoftGraphAdapter extends BaseEmailAdapter {
  private httpClient: AxiosInstance;
  private baseUrl = 'https://graph.microsoft.com/v1.0';
  
  constructor(config: EmailProviderConfig) {
    super(config);
    
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
   * Load stored credentials from the secret provider
   */
  protected async loadCredentials(): Promise<void> {
    try {
      const secretProvider = await getSecretProviderInstance();
      const secret = await secretProvider.getTenantSecret(
        this.config.tenant, 
        'email_provider_credentials'
      );

      if (!secret) {
        throw new Error('No email provider credentials found');
      }

      const allCredentials = JSON.parse(secret);
      const credentials = allCredentials[this.config.id];

      if (!credentials || credentials.provider !== 'microsoft') {
        throw new Error('Microsoft credentials not found');
      }

      this.accessToken = credentials.accessToken;
      this.refreshToken = credentials.refreshToken;
      this.tokenExpiresAt = new Date(credentials.accessTokenExpiresAt);

      this.log('info', 'Credentials loaded successfully');
    } catch (error) {
      throw this.handleError(error, 'loadCredentials');
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

      const secretProvider = await getSecretProviderInstance();
      const clientId = await secretProvider.getTenantSecret(this.config.tenant, 'microsoft_client_id');
      const clientSecret = await secretProvider.getTenantSecret(this.config.tenant, 'microsoft_client_secret');

      if (!clientId || !clientSecret) {
        throw new Error('Microsoft OAuth credentials not configured');
      }

      const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
      const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token',
        scope: 'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadWrite',
      });

      const response = await axios.post(tokenUrl, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      const { 
        access_token, 
        refresh_token, 
        expires_in 
      } = response.data;

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
      const secretProvider = await getSecretProviderInstance();
      const secret = await secretProvider.getTenantSecret(
        this.config.tenant, 
        'email_provider_credentials'
      );

      const allCredentials = secret ? JSON.parse(secret) : {};
      
      allCredentials[this.config.id] = {
        provider: 'microsoft',
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
        accessTokenExpiresAt: this.tokenExpiresAt?.toISOString(),
        refreshTokenExpiresAt: this.tokenExpiresAt ? 
          new Date(this.tokenExpiresAt.getTime() + (30 * 24 * 60 * 60 * 1000)).toISOString() : // 30 days
          undefined,
        mailbox: this.config.mailbox,
        tenantId: this.config.provider_config?.tenantId,
      };

      await secretProvider.setTenantSecret(
        this.config.tenant,
        'email_provider_credentials',
        JSON.stringify(allCredentials, null, 2)
      );
    } catch (error) {
      this.log('warn', 'Failed to update stored credentials', error);
    }
  }

  /**
   * Connect to Microsoft Graph API
   */
  async connect(): Promise<void> {
    try {
      await this.loadCredentials();
      await this.testConnection();
      this.log('info', 'Connected to Microsoft Graph API successfully');
    } catch (error) {
      throw this.handleError(error, 'connect');
    }
  }

  /**
   * Register webhook subscription for incoming messages
   */
  async registerWebhookSubscription(): Promise<void> {
    try {
      const webhookUrl = this.config.webhook_notification_url;
      if (!webhookUrl) {
        throw new Error('Webhook notification URL not configured');
      }

      const subscription = {
        changeType: 'created',
        notificationUrl: webhookUrl,
        resource: `/me/mailFolders('${this.config.folder_to_monitor}')/messages`,
        expirationDateTime: new Date(Date.now() + (3 * 24 * 60 * 60 * 1000)).toISOString(), // 3 days
        clientState: this.config.webhook_verification_token || 'email-webhook-verification',
      };

      const response = await this.httpClient.post('/subscriptions', subscription);
      
      // Update config with subscription ID
      this.config.webhook_subscription_id = response.data.id;
      this.config.webhook_expires_at = response.data.expirationDateTime;

      this.log('info', `Webhook subscription created: ${response.data.id}`);
    } catch (error) {
      throw this.handleError(error, 'registerWebhookSubscription');
    }
  }

  /**
   * Renew webhook subscription before expiration
   */
  async renewWebhookSubscription(): Promise<void> {
    try {
      if (!this.config.webhook_subscription_id) {
        throw new Error('No webhook subscription to renew');
      }

      const newExpiry = new Date(Date.now() + (3 * 24 * 60 * 60 * 1000)).toISOString();
      
      await this.httpClient.patch(`/subscriptions/${this.config.webhook_subscription_id}`, {
        expirationDateTime: newExpiry,
      });

      this.config.webhook_expires_at = newExpiry;
      this.config.last_subscription_renewal = new Date().toISOString();

      this.log('info', `Webhook subscription renewed until ${newExpiry}`);
    } catch (error) {
      throw this.handleError(error, 'renewWebhookSubscription');
    }
  }

  /**
   * Process webhook notification from Microsoft Graph
   */
  async processWebhookNotification(payload: any): Promise<string[]> {
    try {
      const messageIds: string[] = [];

      if (payload.value && Array.isArray(payload.value)) {
        for (const notification of payload.value) {
          if (notification.changeType === 'created' && notification.resourceData) {
            messageIds.push(notification.resourceData.id);
          }
        }
      }

      this.log('info', `Processed webhook notification with ${messageIds.length} messages`);
      return messageIds;
    } catch (error) {
      throw this.handleError(error, 'processWebhookNotification');
    }
  }

  /**
   * Mark a message as read
   */
  async markMessageProcessed(messageId: string): Promise<void> {
    try {
      await this.httpClient.patch(`/me/messages/${messageId}`, {
        isRead: true,
      });

      this.log('info', `Marked message ${messageId} as read`);
    } catch (error) {
      this.log('warn', `Failed to mark message as read: ${(error as Error).message}`);
    }
  }

  /**
   * Get detailed message information
   */
  async getMessageDetails(messageId: string): Promise<EmailMessageDetails> {
    try {
      const response = await this.httpClient.get(`/me/messages/${messageId}`, {
        params: {
          $expand: 'attachments',
        },
      });

      const message = response.data;

      return {
        id: message.id,
        provider: 'microsoft',
        providerId: this.config.id,
        receivedAt: message.receivedDateTime,
        from: {
          email: message.from?.emailAddress?.address || '',
          name: message.from?.emailAddress?.name,
        },
        to: message.toRecipients?.map((recipient: any) => ({
          email: recipient.emailAddress?.address || '',
          name: recipient.emailAddress?.name,
        })) || [],
        cc: message.ccRecipients?.map((recipient: any) => ({
          email: recipient.emailAddress?.address || '',
          name: recipient.emailAddress?.name,
        })),
        subject: message.subject || '',
        body: {
          text: message.body?.content || '',
          html: message.body?.contentType === 'html' ? message.body?.content : undefined,
        },
        attachments: message.attachments?.map((attachment: any) => ({
          id: attachment.id,
          name: attachment.name,
          contentType: attachment.contentType,
          size: attachment.size,
          contentId: attachment.contentId,
        })),
        threadId: message.conversationId,
        references: message.internetMessageHeaders?.find((h: any) => h.name === 'References')?.value?.split(' '),
        inReplyTo: message.internetMessageHeaders?.find((h: any) => h.name === 'In-Reply-To')?.value,
        tenant: this.config.tenant,
        headers: message.internetMessageHeaders?.reduce((acc: any, header: any) => {
          acc[header.name] = header.value;
          return acc;
        }, {}),
        messageSize: message.bodyPreview?.length,
        importance: message.importance,
        sensitivity: message.sensitivity,
      };
    } catch (error) {
      throw this.handleError(error, 'getMessageDetails');
    }
  }

  /**
   * Test the connection to Microsoft Graph
   */
  async testConnection(): Promise<{ success: boolean; error?: string; }> {
    try {
      await this.httpClient.get('/me');
      return { success: true };
    } catch (error: any) {
      return { 
        success: false, 
        error: error.message || 'Connection test failed' 
      };
    }
  }

  /**
   * Disconnect and cleanup resources
   */
  async disconnect(): Promise<void> {
    try {
      // Delete webhook subscription if it exists
      if (this.config.webhook_subscription_id) {
        try {
          await this.httpClient.delete(`/subscriptions/${this.config.webhook_subscription_id}`);
          this.log('info', 'Webhook subscription deleted');
        } catch (error) {
          this.log('warn', 'Failed to delete webhook subscription', error);
        }
      }

      // Clear tokens
      this.accessToken = undefined;
      this.refreshToken = undefined;
      this.tokenExpiresAt = undefined;

      this.log('info', 'Disconnected from Microsoft Graph API');
    } catch (error) {
      throw this.handleError(error, 'disconnect');
    }
  }

  /**
   * Initialize webhook subscription for email notifications
   */
  async initializeWebhook(webhookUrl: string): Promise<{ success: boolean; subscriptionId?: string; error?: string }> {
    try {
      this.log('info', `Initializing webhook subscription to ${webhookUrl}`);

      const subscription = {
        changeType: 'created',
        notificationUrl: webhookUrl,
        resource: `/me/mailFolders('Inbox')/messages`,
        expirationDateTime: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(), // 72 hours
        clientState: 'secretClientValue'
      };

      const response = await this.httpClient.post('/subscriptions', subscription);
      const subscriptionId = response.data.id;

      this.log('info', `Webhook subscription created: ${subscriptionId}`);
      
      return {
        success: true,
        subscriptionId
      };
    } catch (error: any) {
      this.log('error', 'Failed to initialize webhook', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}