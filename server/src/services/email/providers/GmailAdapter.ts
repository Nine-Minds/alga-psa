import axios, { AxiosInstance } from 'axios';
import { BaseEmailAdapter } from '@alga-psa/shared/services/email/providers/base/BaseEmailAdapter';
import { EmailMessageDetails, EmailProviderConfig } from '@alga-psa/shared/interfaces/inbound-email.interfaces';
import { getSecretProviderInstance } from '@alga-psa/core';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { getAdminConnection } from '@alga-psa/db/admin';

/**
 * Gmail API adapter for email processing
 * Handles OAuth authentication, Pub/Sub subscriptions, and message retrieval
 */
export class GmailAdapter extends BaseEmailAdapter {
  private httpClient: AxiosInstance;
  private baseUrl = 'https://gmail.googleapis.com/gmail/v1';
  private oauth2Client: OAuth2Client;
  private gmail: any;
  
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

    // Initialize OAuth2 client (will be configured with credentials later)
    this.oauth2Client = new OAuth2Client();
    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });

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
      if (!vendorConfig.access_token || !vendorConfig.refresh_token) {
        throw new Error('OAuth tokens not found in provider configuration. Please complete OAuth authorization.');
      }

      this.accessToken = vendorConfig.access_token;
      this.refreshToken = vendorConfig.refresh_token;
      this.tokenExpiresAt = vendorConfig.token_expires_at ? new Date(vendorConfig.token_expires_at) : new Date();

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
      let clientId = vendorConfig.client_id || process.env.GOOGLE_CLIENT_ID;
      let clientSecret = vendorConfig.client_secret || process.env.GOOGLE_CLIENT_SECRET;
      
      // Fall back to tenant secrets if not found in config or environment
      if (!clientId || !clientSecret) {
        const secretProvider = await getSecretProviderInstance();
        clientId = clientId || await secretProvider.getTenantSecret(this.config.tenant, 'google_client_id');
        clientSecret = clientSecret || await secretProvider.getTenantSecret(this.config.tenant, 'google_client_secret');
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

      // Update gmail client
      this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });

      this.log('info', 'Access token refreshed successfully');
    } catch (error) {
      throw this.handleError(error, 'refreshAccessToken');
    }
  }

  /**
   * Update stored credentials with new tokens
   * This method updates both in-memory config and persists changes to the database.
   */
  private async updateStoredCredentials(): Promise<void> {
    try {
      // Update the provider config with new tokens
      if (this.config.provider_config) {
        this.config.provider_config.access_token = this.accessToken;
        this.config.provider_config.refresh_token = this.refreshToken;
        this.config.provider_config.token_expires_at = this.tokenExpiresAt?.toISOString();
      }
      
      this.log('info', 'Updated credentials in provider configuration');

      // Persist updated credentials to database
      try {
        const knex = await getAdminConnection();
        await knex('google_email_provider_config')
          .where({ tenant: this.config.tenant, email_provider_id: this.config.id })
          .update({
            access_token: this.accessToken,
            refresh_token: this.refreshToken,
            token_expires_at: this.tokenExpiresAt?.toISOString(),
            updated_at: new Date().toISOString()
          });
        
        this.log('info', 'Successfully persisted refreshed OAuth tokens to database');
      } catch (dbError: any) {
        this.log('error', `Failed to persist credentials to database: ${dbError.message}`, dbError);
        // Don't throw here - we still have the tokens in memory, so the current operation can continue
        // But log the error so we know there's a persistence issue
      }
    } catch (error) {
      this.log('warn', 'Failed to update stored credentials', error);
      throw error; // Re-throw for the calling method to handle
    }
  }

  /**
   * Connect to Gmail API
   */
  async connect(): Promise<void> {
    try {
      await this.loadCredentials();
      await this.testConnection();
      this.log('info', 'Connected to Gmail API successfully');
    } catch (error) {
      throw this.handleError(error, 'connect');
    }
  }

  /**
   * Register webhook subscription using Google Pub/Sub
   */
  async registerWebhookSubscription(): Promise<void> {
    try {
      const vendorConfig = this.config.provider_config || {};
      const topicName = vendorConfig.pubsub_topic_name;
      const projectId = vendorConfig.project_id;
      
      if (!topicName) {
        throw new Error('Pub/Sub topic name not configured');
      }

      if (!projectId) {
        throw new Error('Google Cloud project ID not configured');
      }

      console.log('📦 vendorConfig', vendorConfig);

      // Check if user has completed OAuth authorization
      if (!vendorConfig.access_token || !vendorConfig.refresh_token) {
        const errorMsg = `Gmail watch subscription setup failed: OAuth tokens are missing. 
Expected tokens to be saved after OAuth authorization but found:
- access_token: ${vendorConfig.access_token ? '[PRESENT]' : '[MISSING]'}
- refresh_token: ${vendorConfig.refresh_token ? '[PRESENT]' : '[MISSING]'}
This indicates a problem with the OAuth token saving process.`;
        
        this.log('error', errorMsg);
        throw new Error('Gmail OAuth tokens are missing. Please check the OAuth authorization flow.');
      }

      // Load credentials and ensure valid token
      await this.ensureValidToken();

      // Determine label filters (user-defined label names only)
      let requestedFilters: string[] = Array.isArray(vendorConfig.label_filters)
        ? (vendorConfig.label_filters as string[]).map((s: string) => s?.trim()).filter(Boolean)
        : [];
      // If not present on the in-memory config, attempt to load from DB
      if (requestedFilters.length === 0) {
        try {
          const knex = await getAdminConnection();
          const rec: any = await knex('google_email_provider_config')
            .select('label_filters')
            .where({ tenant: this.config.tenant, email_provider_id: this.config.id })
            .first();
          const fromDb = Array.isArray(rec?.label_filters)
            ? rec.label_filters
            : (() => { try { return JSON.parse(rec?.label_filters || '[]'); } catch { return []; } })();
          requestedFilters = (Array.isArray(fromDb) ? fromDb : []).map((s: string) => s?.trim()).filter(Boolean);
        } catch (e: any) {
          this.log('warn', 'Unable to load label_filters from DB; proceeding without label filters', e);
        }
      }

      // Deduplicate while preserving order
      const uniqueFilters = Array.from(new Set(requestedFilters));

      // Resolve user label names to IDs (no special-casing of system labels)
      let effectiveLabelIds: string[] = [];
      if (uniqueFilters.length > 0) {
        try {
          const labelsResp = await this.gmail.users.labels.list({ userId: 'me' });
          const allLabels: Array<{ id?: string; name?: string }> = (labelsResp.data.labels as any) || [];
          effectiveLabelIds = uniqueFilters.map(f => allLabels.find(l => l.name === f)?.id).filter((id): id is string => !!id);
          const missing = uniqueFilters.filter(f => !allLabels.find(l => l.name === f)?.id);
          if (missing.length > 0) {
            this.log('warn', `Some Gmail label filters were not found and will be ignored`, { missing });
          }
        } catch (e: any) {
          this.log('warn', `Failed to resolve Gmail labels; proceeding without label filters: ${e?.message || e}`);
          effectiveLabelIds = [];
        }
      }

      // Build watch request; include label filters only when provided
      const watchBody: any = {
        topicName: `projects/${projectId}/topics/${topicName}`,
      };
      if (effectiveLabelIds.length > 0) {
        watchBody.labelIds = effectiveLabelIds;
        watchBody.labelFilterBehavior = 'include';
      }
      const response = await this.gmail.users.watch({
        userId: 'me',
        requestBody: watchBody
      });

      console.log('✅ Gmail watch response:', response.data);
      this.log('info', 'Gmail watch configured', { labelFilters: uniqueFilters, effectiveLabelIds });

      // Store the history ID for tracking changes in provider config
      if (!this.config.provider_config) {
        this.config.provider_config = {};
      }
      this.config.provider_config.history_id = response.data.historyId;
      
      // Handle expiration date safely - Gmail API returns expiration as a string timestamp in milliseconds
      let expirationISO: string | null = null;
      if (response.data.expiration) {
        try {
          // Gmail API returns expiration as a string of milliseconds since epoch
          const expirationMs = parseInt(response.data.expiration, 10);
          if (!isNaN(expirationMs) && expirationMs > 0) {
            expirationISO = new Date(expirationMs).toISOString();
          }
        } catch (err) {
          this.log('warn', `Failed to parse expiration date: ${response.data.expiration}`, err);
        }
      }
      
      this.config.provider_config.watch_expiration = expirationISO || undefined;

      // Save updated history_id and watch_expiration to database
      try {
        const knex = await getAdminConnection();
        await knex('google_email_provider_config')
          .where({ tenant: this.config.tenant, email_provider_id: this.config.id })
          .update({
            history_id: response.data.historyId,
            watch_expiration: expirationISO,
            updated_at: new Date().toISOString()
          });
        this.log('info', 'Updated database with new watch subscription details');
      } catch (dbError: any) {
        this.log('error', 'Failed to update database with watch subscription details', dbError);
        // Continue execution - the watch subscription is still valid even if DB update fails
      }

      this.log('info', `Gmail watch created with historyId: ${response.data.historyId}, expiration: ${expirationISO}`);
    } catch (error) {
      throw this.handleError(error, 'registerWebhookSubscription');
    }
  }

  /**
   * Renew webhook subscription
   */
  async renewWebhookSubscription(): Promise<void> {
    try {
      // Load credentials and ensure valid token
      await this.ensureValidToken();
      
      // Stop existing watch subscription first
      try {
        // await this.gmail.users.stop({ userId: 'me' });
        this.log('info', 'Stopped existing Gmail watch subscription');
      } catch (error: any) {
        // It's okay if there's no existing watch to stop
        this.log('warn', `No existing watch to stop: ${error.message}`);
      }
      
      // Create new watch subscription
      await this.registerWebhookSubscription();
      
      this.log('info', 'Successfully renewed Gmail watch subscription');
    } catch (error) {
      this.log('error', 'Failed to renew Gmail watch subscription', error);
      throw error;
    }
  }

  /**
   * Process webhook notification from Google Pub/Sub
   */
  async processWebhookNotification(payload: any): Promise<string[]> {
    try {
      const messageIds: string[] = [];
      const vendorConfig = this.config.provider_config || {};
      
      // Extract historyId from the notification
      const historyId = payload.historyId;
      const lastHistoryId = this.config.provider_config?.history_id;

      if (!historyId || !lastHistoryId) {
        this.log('warn', 'Missing history ID in webhook notification');
        return messageIds;
      }

      // Get history of changes since last known historyId
      const history = await this.gmail.users.history.list({
        userId: 'me',
        startHistoryId: lastHistoryId,
        historyTypes: ['messageAdded'],
        labelId: 'INBOX'
      });

      if (history.data.history) {
        for (const record of history.data.history) {
          if (record.messagesAdded) {
            for (const msg of record.messagesAdded) {
              messageIds.push(msg.message.id);
            }
          }
        }
      }

      // Update last known historyId
      if (history.data.historyId) {
        if (!this.config.provider_config) {
          this.config.provider_config = {};
        }
        this.config.provider_config.history_id = history.data.historyId;
      }

      return messageIds;
    } catch (error) {
      throw this.handleError(error, 'processWebhookNotification');
    }
  }

  /**
   * List Gmail message IDs added since a given historyId
   */
  async listMessagesSince(startHistoryId: string): Promise<string[]> {
    try {
      await this.ensureValidToken();
      const messageIds: string[] = [];

      let pageToken: string | undefined = undefined;
      let lastHistoryId = startHistoryId;

      do {
        const historyResp: any = await this.gmail.users.history.list({
          userId: 'me',
          startHistoryId: startHistoryId, // Use original startHistoryId for pagination consistency
          historyTypes: ['messageAdded'],
          // labelId: 'INBOX', // Removed to allow processing of all incoming messages (even if archived/filtered)
          pageToken,
        });

        if (historyResp.data.history) {
          for (const record of historyResp.data.history) {
            if (record.messagesAdded) {
              for (const msg of record.messagesAdded) {
                if (msg.message?.id) {
                  messageIds.push(msg.message.id);
                }
              }
            }
            // Track the most recent historyId seen to update our cursor
            if (record.id) {
              lastHistoryId = record.id;
            }
          }
        }

        pageToken = historyResp.data.nextPageToken || undefined;

        // Update stored last historyId if API returned a newer one
        const newHistoryId = historyResp.data.historyId || lastHistoryId;
        if (!this.config.provider_config) {
          this.config.provider_config = {};
        }
        this.config.provider_config.history_id = newHistoryId;
      } while (pageToken);

      return Array.from(new Set(messageIds));
    } catch (error) {
      const gmailNotFound = this.isHistoryIdNotFoundError(error);
      if (gmailNotFound) {
        const axiosError = error as any;
        await this.attemptWatchRecovery(startHistoryId);
        const historyError = new Error('Gmail history_id is no longer valid. Request a resync and establish a new watch.');
        (historyError as any).code = 'gmail.historyIdNotFound';
        (historyError as any).status = 404;
        (historyError as any).responseBody = axiosError?.response?.data;
        (historyError as any).requestId = axiosError?.response?.headers?.['request-id'] || axiosError?.response?.headers?.['client-request-id'];
        this.log('warn', 'Gmail history_id rejected by API; downstream should reset cursor and re-register watch.', {
          providerId: this.config.id,
          attemptedHistoryId: startHistoryId
        });
        throw historyError;
      }
      throw this.handleError(error, 'listMessagesSince');
    }
  }

  private isHistoryIdNotFoundError(error: any): boolean {
    if (!error) return false;
    const status = error?.response?.status || error?.status;
    if (status !== 404) return false;

    const errorBody = error?.response?.data?.error || {};
    const reason = Array.isArray(errorBody?.errors) ? errorBody.errors.find((e: any) => e?.reason)?.reason : undefined;
    const message: string = errorBody?.message || error?.message || '';
    const matchedReason = reason === 'notFound';
    const matchedStatus = (errorBody?.status || '').toUpperCase() === 'NOT_FOUND';
    const matchedMessage = typeof message === 'string' && message.toLowerCase().includes('requested entity was not found');
    return Boolean(matchedReason || matchedStatus || matchedMessage);
  }

  private async attemptWatchRecovery(startHistoryId: string): Promise<void> {
    try {
      this.log('info', 'Attempting to recreate Gmail watch after history_id invalidation', {
        providerId: this.config.id,
        rejectedHistoryId: startHistoryId
      });
      await this.registerWebhookSubscription();
      this.log('info', 'Gmail watch recreated successfully after history_id invalidation');
    } catch (recoveryError: any) {
      this.log('error', 'Failed to recreate Gmail watch after history_id invalidation', recoveryError);
    }
  }

  /**
   * Mark a message as processed (READ-ONLY MODE: No-op)
   * Note: This system now operates in read-only mode and does not modify emails.
   * Email processing status is tracked in the database instead.
   */
  async markMessageProcessed(messageId: string): Promise<void> {
    this.log('info', `Email ${messageId} processed (read-only mode - not adding labels in mailbox)`);
    // No API call made - operating in read-only mode
  }

  /**
   * Get detailed information about a specific email message
   */
  async getMessageDetails(messageId: string): Promise<EmailMessageDetails> {
    try {
      const message = await this.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full'
      });

      // Skip Drafts and Sent messages
      const labelIds = message.data.labelIds || [];
      if (labelIds.includes('DRAFT') || labelIds.includes('SENT')) {
        throw new Error('Message is a DRAFT/SENT type, skipping');
      }

      const headers = message.data.payload?.headers || [];
      const getHeader = (name: string) => 
        headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

      // Extract body content
      let bodyContent = '';
      let htmlContent = '';
      
      const extractBody = (parts: any[]): void => {
        for (const part of parts) {
          if (part.mimeType === 'text/plain' && part.body?.data) {
            bodyContent = Buffer.from(part.body.data, 'base64').toString();
          } else if (part.mimeType === 'text/html' && part.body?.data) {
            htmlContent = Buffer.from(part.body.data, 'base64').toString();
          } else if (part.parts) {
            extractBody(part.parts);
          }
        }
      };

      if (message.data.payload?.parts) {
        extractBody(message.data.payload.parts);
      } else if (message.data.payload?.body?.data) {
        bodyContent = Buffer.from(message.data.payload.body.data, 'base64').toString();
      }

      // Extract attachments
      const attachments: any[] = [];
      const extractAttachments = (parts: any[]): void => {
        for (const part of parts) {
          if (part.filename && part.body?.attachmentId) {
            const partHeaders = part.headers || [];
            const getPartHeader = (name: string) =>
              partHeaders.find((h: any) => String(h.name || '').toLowerCase() === name.toLowerCase())?.value || '';

            const contentDisposition = String(getPartHeader('Content-Disposition') || '').toLowerCase();
            const isInline = contentDisposition.includes('inline');

            const rawContentId = String(getPartHeader('Content-ID') || '').trim();
            const contentId = rawContentId ? rawContentId.replace(/^<|>$/g, '') : undefined;

            attachments.push({
              filename: part.filename,
              mimeType: part.mimeType,
              size: part.body.size,
              attachmentId: part.body.attachmentId,
              contentId,
              isInline
            });
          } else if (part.parts) {
            extractAttachments(part.parts);
          }
        }
      };

      if (message.data.payload?.parts) {
        extractAttachments(message.data.payload.parts);
      }

      const fromEmail = getHeader('From') || '';
      const toEmails = getHeader('To') || '';
      const ccEmails = getHeader('Cc') || '';
      
      return {
        id: message.data.id!,
        provider: 'google' as const,
        providerId: this.config.id,
        tenant: this.config.tenant,
        receivedAt: getHeader('Date') || new Date().toISOString(),
        from: {
          email: fromEmail.includes('<') ? fromEmail.split('<')[1].split('>')[0] : fromEmail,
          name: fromEmail.includes('<') ? fromEmail.split('<')[0].trim() : undefined
        },
        to: toEmails ? toEmails.split(',').map((email: string) => ({
          email: email.includes('<') ? email.split('<')[1].split('>')[0].trim() : email.trim(),
          name: email.includes('<') ? email.split('<')[0].trim() : undefined
        })) : [],
        cc: ccEmails ? ccEmails.split(',').map((email: string) => ({
          email: email.includes('<') ? email.split('<')[1].split('>')[0].trim() : email.trim(),
          name: email.includes('<') ? email.split('<')[0].trim() : undefined
        })) : undefined,
        subject: getHeader('Subject') || '',
        body: {
          text: bodyContent,
          html: htmlContent
        },
        attachments: attachments.map(att => ({
          id: att.attachmentId,
          name: att.filename,
          size: att.size,
          contentType: att.mimeType,
          contentId: att.contentId,
          isInline: att.isInline
        })),
        headers: headers.reduce((acc: any, header: any) => {
          acc[header.name] = header.value;
          return acc;
        }, {})
      };
    } catch (error) {
      throw this.handleError(error, 'getMessageDetails');
    }
  }

  /**
   * Download attachment bytes for a Gmail message.
   *
   * Gmail returns attachment payload as base64url in `data`.
   */
  async downloadAttachmentBytes(messageId: string, attachmentId: string): Promise<Buffer> {
    try {
      await this.ensureValidToken();
      const res = await this.gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: attachmentId,
      });

      const raw: string | undefined = res?.data?.data;
      if (!raw) {
        throw new Error('Attachment data missing');
      }

      const base64 = raw.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(raw.length / 4) * 4, '=');
      return Buffer.from(base64, 'base64');
    } catch (error) {
      throw this.handleError(error, 'downloadAttachmentBytes');
    }
  }

  /**
   * Test the connection to Gmail API
   */
  async testConnection(): Promise<{ success: boolean; error?: string; }> {
    try {
      // Try to get the user's profile
      const profile = await this.gmail.users.getProfile({ userId: 'me' });
      
      if (profile.data.emailAddress !== this.config.mailbox) {
        return {
          success: false,
          error: `Email mismatch: expected ${this.config.mailbox}, got ${profile.data.emailAddress}`
        };
      }

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to connect to Gmail API'
      };
    }
  }

  /**
   * Disconnect from Gmail API
   */
  async disconnect(): Promise<void> {
    // Gmail doesn't require explicit disconnect
    this.log('info', 'Disconnected from Gmail API');
  }
}
