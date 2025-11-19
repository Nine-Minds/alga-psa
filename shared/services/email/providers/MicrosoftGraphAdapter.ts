import axios, { AxiosInstance } from 'axios';
import { BaseEmailAdapter } from './base/BaseEmailAdapter';
import { EmailMessageDetails, EmailProviderConfig } from '../../../interfaces/inbound-email.interfaces';
import { getSecretProviderInstance } from '../../../core';
import { getAdminConnection } from '../../../db/admin';

/**
 * Microsoft Graph API adapter for email processing
 * Handles OAuth authentication, webhook subscriptions, and message retrieval
 */
export class MicrosoftGraphAdapter extends BaseEmailAdapter {
  private httpClient: AxiosInstance;
  private baseUrl = 'https://graph.microsoft.com/v1.0';
  private authenticatedUserEmail: string | undefined; // Email of the user who authorized the app

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
   * Build Microsoft Graph base path for the configured mailbox.
   * Auto-detects whether to use /me or /users/{mailbox} based on:
   * - If configured mailbox matches the authenticated user → use /me (personal account, no admin consent needed)
   * - If configured mailbox differs → use /users/{mailbox} (shared/delegated mailbox)
   */
  private getMailboxBasePath(): string {
    const configuredMailbox = (this.config.mailbox || '').trim();

    // If no mailbox configured, use current user (/me)
    if (!configuredMailbox) {
      return '/me';
    }

    // If we have the authenticated user's email, compare it with the configured mailbox
    if (this.authenticatedUserEmail) {
      // Normalize emails for comparison (case-insensitive)
      const normalizedConfigured = configuredMailbox.toLowerCase();
      const normalizedAuthenticated = this.authenticatedUserEmail.toLowerCase();

      // If they match, this is the authenticated user's personal mailbox → use /me
      if (normalizedConfigured === normalizedAuthenticated) {
        this.log('info', 'Using /me path for personal mailbox', {
          authenticatedUser: normalizedAuthenticated,
          configuredMailbox: normalizedConfigured
        });
        return '/me';
      }

      // Otherwise, it's a shared or delegated mailbox → use /users/{mailbox}
      this.log('info', 'Using /users/{mailbox} path for shared/delegated mailbox', {
        authenticatedUser: normalizedAuthenticated,
        configuredMailbox: normalizedConfigured
      });
      return `/users/${encodeURIComponent(configuredMailbox)}`;
    }

    // Fallback: if we haven't fetched authenticated user email yet, assume /users/{mailbox}
    // This will be corrected once loadAuthenticatedUserEmail() is called
    this.log('warn', 'Authenticated user email not yet loaded; using /users/{mailbox} path');
    return `/users/${encodeURIComponent(configuredMailbox)}`;
  }

  /**
   * Resolve a folder resource path for subscriptions and message retrieval.
   */
  private async buildFolderResourcePath(desiredFolder: string): Promise<{ resource: string; resolvedFolder: string }> {
    const mailboxBase = this.getMailboxBasePath();
    const fallbackResult = {
      resource: `${mailboxBase}/mailFolders('Inbox')/messages`,
      resolvedFolder: 'Inbox',
    };

    const requested = (desiredFolder || 'Inbox').trim();
    if (!requested) {
      return fallbackResult;
    }

    const wellKnownMap: Record<string, string> = {
      inbox: 'Inbox',
      archive: 'Archive',
      drafts: 'Drafts',
      deleteditems: 'DeletedItems',
      junkemail: 'JunkEmail',
      sentitems: 'SentItems',
      outbox: 'Outbox',
      conversationhistory: 'ConversationHistory',
      clutter: 'Clutter',
      conflicts: 'Conflicts',
      localfailures: 'LocalFailures',
      serverfailures: 'ServerFailures',
      syncissues: 'SyncIssues',
    };

    const normalizedKey = requested.toLowerCase().replace(/\s+/g, '');
    if (wellKnownMap[normalizedKey]) {
      return {
        resource: `${mailboxBase}/mailFolders('${wellKnownMap[normalizedKey]}')/messages`,
        resolvedFolder: requested,
      };
    }

    try {
      const list = await this.httpClient.get(`${mailboxBase}/mailFolders`, {
        params: { $select: 'id,displayName' },
      });
      const match = (list.data?.value || []).find(
        (f: any) => (f.displayName || '').toLowerCase() === requested.toLowerCase()
      );
      if (match?.id) {
        const folderId = String(match.id).replace(/'/g, "''");
        return {
          resource: `${mailboxBase}/mailFolders('${folderId}')/messages`,
          resolvedFolder: match.displayName || requested,
        };
      }
      this.log('warn', `Folder '${requested}' not found; defaulting subscription to Inbox`);
    } catch (error: any) {
      this.log('warn', `Failed to resolve folder '${requested}'; defaulting to Inbox`, error?.message || error);
    }

    return fallbackResult;
  }

  /**
   * Load stored credentials from the secret provider
   */
  protected async loadCredentials(): Promise<void> {
    try {
      const vendorConfig = this.config.provider_config || {};

      // Preferred: load from DB-backed provider_config (parity with Gmail)
      if (vendorConfig.access_token && vendorConfig.refresh_token) {
        this.accessToken = vendorConfig.access_token;
        this.refreshToken = vendorConfig.refresh_token;
        this.tokenExpiresAt = vendorConfig.token_expires_at
          ? new Date(vendorConfig.token_expires_at)
          : undefined;
        this.log('info', 'Loaded Microsoft OAuth credentials from provider configuration');
        return;
      }

      // Temporary fallback: read from tenant secret storage (read-only)
      try {
        const secretProvider = await getSecretProviderInstance();
        const secret = await secretProvider.getTenantSecret(
          this.config.tenant,
          'email_provider_credentials'
        );
        if (secret) {
          const allCredentials = JSON.parse(secret);
          const credentials = allCredentials[this.config.id];
          if (credentials && credentials.provider === 'microsoft') {
            this.accessToken = credentials.accessToken;
            this.refreshToken = credentials.refreshToken;
            this.tokenExpiresAt = credentials.accessTokenExpiresAt
              ? new Date(credentials.accessTokenExpiresAt)
              : undefined;
            this.log('info', 'Loaded Microsoft OAuth credentials from secrets (fallback)');
            return;
          }
        }
      } catch (e) {
        this.log('warn', 'Failed to read credentials from secrets provider (fallback).');
      }

      throw new Error('Microsoft OAuth tokens not found. Please complete authorization.');
    } catch (error) {
      throw this.handleError(error, 'loadCredentials');
    }
  }

  /**
   * Fetch the authenticated user's email address from /me endpoint
   * This is used to auto-detect whether the configured mailbox is a personal account
   * or a shared/delegated mailbox
   */
  private async loadAuthenticatedUserEmail(): Promise<void> {
    try {
      // Query /me endpoint to get the authenticated user's principal email
      const response = await this.httpClient.get('/me', {
        params: {
          $select: 'userPrincipalName,mail'
        }
      });

      // Prefer userPrincipalName (common format), fallback to mail field
      this.authenticatedUserEmail = response.data.userPrincipalName || response.data.mail;

      if (this.authenticatedUserEmail) {
        this.log('info', 'Loaded authenticated user email for mailbox detection', {
          email: this.authenticatedUserEmail
        });
      } else {
        this.log('warn', 'Could not determine authenticated user email from /me endpoint');
      }
    } catch (error) {
      // Non-fatal error: log but don't throw
      // The adapter will still work, it will just default to /users/{mailbox} path
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
      let clientId = vendorConfig.client_id || process.env.MICROSOFT_CLIENT_ID;
      let clientSecret = vendorConfig.client_secret || process.env.MICROSOFT_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        const secretProvider = await getSecretProviderInstance();
        clientId = clientId || (await secretProvider.getTenantSecret(this.config.tenant, 'microsoft_client_id'));
        clientSecret = clientSecret || (await secretProvider.getTenantSecret(this.config.tenant, 'microsoft_client_secret'));
      }

      if (!clientId || !clientSecret) {
        throw new Error('Microsoft OAuth credentials not configured');
      }

      // Determine tenant authority for single-tenant apps
      const vendorTenantId = (this.config.provider_config as any)?.tenant_id || this.config.provider_config?.tenantId;
      let tenantAuthority = vendorTenantId || process.env.MICROSOFT_TENANT_ID;
      if (!tenantAuthority) {
        try {
          const secretProvider = await getSecretProviderInstance();
          tenantAuthority = await secretProvider.getTenantSecret(this.config.tenant, 'microsoft_tenant_id')
            || await secretProvider.getAppSecret('MICROSOFT_TENANT_ID')
            || 'common';
        } catch {
          tenantAuthority = 'common';
        }
      }

      const tokenUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/token`;
      const params = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token',
        scope: 'https://graph.microsoft.com/Mail.Read offline_access',
      });

      const response = await axios.post(tokenUrl, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      const { access_token, refresh_token, expires_in } = response.data;

      this.accessToken = access_token;
      if (refresh_token) {
        this.refreshToken = refresh_token;
      }

      // Calculate expiry with 5-minute buffer
      const expiryTime = new Date(Date.now() + (Number(expires_in || 3600) - 300) * 1000);
      this.tokenExpiresAt = expiryTime;

      // Update stored credentials (DB + in-memory config)
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
      // Update in-memory provider_config
      if (!this.config.provider_config) this.config.provider_config = {};
      this.config.provider_config.access_token = this.accessToken;
      this.config.provider_config.refresh_token = this.refreshToken;
      this.config.provider_config.token_expires_at = this.tokenExpiresAt?.toISOString();

      // Persist to DB (parity with Gmail)
      try {
        const knex = await getAdminConnection();
        await knex('microsoft_email_provider_config')
          .where('email_provider_id', this.config.id)
          .andWhere('tenant', this.config.tenant)
          .update({
            access_token: this.accessToken,
            refresh_token: this.refreshToken,
            token_expires_at: this.tokenExpiresAt?.toISOString(),
            updated_at: new Date().toISOString(),
          });
        this.log('info', 'Persisted refreshed Microsoft OAuth tokens to database');
      } catch (dbErr: any) {
        this.log('error', `Failed to persist Microsoft credentials to DB: ${dbErr?.message}`);
      }
    } catch (error) {
      this.log('warn', 'Failed to update stored credentials', error);
      throw error;
    }
  }

  /**
   * Connect to Microsoft Graph API
   */
  async connect(): Promise<void> {
    try {
      await this.loadCredentials();
      // Load authenticated user email for mailbox path auto-detection
      await this.loadAuthenticatedUserEmail();
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

      // Microsoft Graph limit for Outlook message subscriptions is 4230 minutes (~70.5 hours)
      // Use a safe window (e.g., 60 hours) to avoid 400 due to out-of-range expiration
      const expirationMs = 60 * 60 * 1000 * 60; // 60 hours in ms

      const desiredFolder = (this.config.folder_to_monitor || 'Inbox').trim();
      const { resource, resolvedFolder } = await this.buildFolderResourcePath(desiredFolder);
      const mailboxBase = this.getMailboxBasePath();

      const subscription = {
        changeType: 'created',
        notificationUrl: webhookUrl,
        resource,
        expirationDateTime: new Date(Date.now() + expirationMs).toISOString(),
        clientState: this.config.webhook_verification_token || 'email-webhook-verification',
      };

      // Log payload with masked clientState for diagnostics
      const maskedState = subscription.clientState
        ? `${String(subscription.clientState).slice(0, 4)}...(${String(subscription.clientState).length})`
        : 'none';
      this.log('info', 'Creating Microsoft subscription', {
        notificationUrl: subscription.notificationUrl,
        resource: subscription.resource,
        expirationDateTime: subscription.expirationDateTime,
        clientState: maskedState,
        mailboxBase,
        folder: resolvedFolder,
      });

      const response = await this.httpClient.post('/subscriptions', subscription);
      
      // Update config with subscription ID
      this.config.webhook_subscription_id = response.data.id;
      this.config.webhook_expires_at = response.data.expirationDateTime;

      // Persist webhook details only in microsoft vendor config
      try {
        const knex = await getAdminConnection();
        await knex('microsoft_email_provider_config')
          .where('email_provider_id', this.config.id)
          .andWhere('tenant', this.config.tenant)
          .update({
            webhook_subscription_id: response.data.id,
            webhook_expires_at: response.data.expirationDateTime,
            webhook_verification_token: this.config.webhook_verification_token || null,
            updated_at: new Date().toISOString(),
          });
      } catch (dbErr: any) {
        this.log('warn', `Failed to persist Microsoft webhook subscription: ${dbErr?.message}`);
      }

      this.log('info', `Webhook subscription created: ${response.data.id}`);
    } catch (error) {
      // Enrich/log details (status, request-id, body) before throwing
      const enriched = this.handleError(error, 'registerWebhookSubscription');
      this.log('error', 'Subscription creation failed', {
        message: enriched.message,
        context: 'registerWebhookSubscription',
      });
      throw enriched;
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

      // Persist renewal
      try {
        const knex = await getAdminConnection();
        await knex('microsoft_email_provider_config')
          .where('email_provider_id', this.config.id)
          .andWhere('tenant', this.config.tenant)
          .update({
            webhook_expires_at: newExpiry,
            last_subscription_renewal: this.config.last_subscription_renewal,
            updated_at: new Date().toISOString()
          });
      } catch (dbErr: any) {
        this.log('warn', `Failed to persist webhook renewal: ${dbErr?.message}`);
      }

      this.log('info', `Webhook subscription renewed until ${newExpiry}`);
    } catch (error) {
      throw this.handleError(error, 'renewWebhookSubscription');
    }
  }

  /**
   * Mark a message as read (READ-ONLY MODE: No-op)
   * Note: This system now operates in read-only mode and does not modify emails.
   * Email processing status is tracked in the database instead.
   */
  async markMessageProcessed(messageId: string): Promise<void> {
    this.log('info', `Email ${messageId} processed (read-only mode - not marking as read in mailbox)`);
    // No API call made - operating in read-only mode
  }

  /**
   * Get detailed message information
   */
  async getMessageDetails(messageId: string): Promise<EmailMessageDetails> {
    try {
      const mailboxBase = this.getMailboxBasePath();
      const response = await this.httpClient.get(`${mailboxBase}/messages/${messageId}`, {
        params: {
          $expand: 'attachments',
          $select:
            'internetMessageHeaders,receivedDateTime,subject,body,bodyPreview,from,toRecipients,ccRecipients,conversationId',
        },
        headers: {
          Prefer: 'outlook.body-content-type="text"',
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
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const mailboxBase = this.getMailboxBasePath();
      await this.httpClient.get(mailboxBase);
      await this.httpClient.get(`${mailboxBase}/mailFolders`, {
        params: { $top: 1, $select: 'id' },
      });
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || 'Connection test failed' };
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

      const expirationMs = 60 * 60 * 1000 * 60; // ~60 hours within Graph limits
      const desiredFolder = (this.config.folder_to_monitor || 'Inbox').trim();
      const { resource, resolvedFolder } = await this.buildFolderResourcePath(desiredFolder);
      const mailboxBase = this.getMailboxBasePath();
      const subscription = {
        changeType: 'created',
        notificationUrl: webhookUrl,
        resource,
        expirationDateTime: new Date(Date.now() + expirationMs).toISOString(),
        clientState: this.config.webhook_verification_token || 'email-webhook-verification',
      };

      this.log('info', 'Posting Microsoft subscription payload', {
        notificationUrl: subscription.notificationUrl,
        resource: subscription.resource,
        expirationDateTime: subscription.expirationDateTime,
        clientState: subscription.clientState ? '**masked**' : 'none',
        mailboxBase,
        folder: resolvedFolder,
      });

      const response = await this.httpClient.post('/subscriptions', subscription);
      
      // Update config with subscription ID
      this.config.webhook_subscription_id = response.data.id;
      this.config.webhook_expires_at = response.data.expirationDateTime;

      // Persist webhook details only in microsoft vendor config
      try {
        const knex = await getAdminConnection();
        await knex('microsoft_email_provider_config')
          .where('email_provider_id', this.config.id)
          .andWhere('tenant', this.config.tenant)
          .update({
            webhook_subscription_id: response.data.id,
            webhook_expires_at: response.data.expirationDateTime,
            webhook_verification_token: this.config.webhook_verification_token || null,
            updated_at: new Date().toISOString(),
          });
      } catch (dbErr: any) {
        this.log('warn', `Failed to persist Microsoft webhook subscription: ${dbErr?.message}`);
      }

      this.log('info', `Webhook subscription created: ${response.data.id}`);

      // Return success with subscription id
      return { success: true, subscriptionId: response.data.id };
    } catch (error) {
      // Enrich/log details (status, request-id, body) before throwing
      const enriched = this.handleError(error, 'registerWebhookSubscription');
      this.log('error', 'Subscription creation failed', {
        message: enriched.message,
        context: 'registerWebhookSubscription',
      });
      // Return error info instead of throwing to satisfy return type
      return { success: false, error: enriched.message };
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
}
