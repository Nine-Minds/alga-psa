import axios, { AxiosInstance } from 'axios';
import { randomUUID } from 'crypto';
import { BaseEmailAdapter } from './base/BaseEmailAdapter';
import { EmailMessageDetails, EmailProviderConfig } from '../../../interfaces/inbound-email.interfaces';
import type {
  Microsoft365DiagnosticsOptions,
  Microsoft365DiagnosticsReport,
  Microsoft365DiagnosticsStep,
  DiagnosticsStepStatus,
} from '../../../interfaces/microsoft365-diagnostics.interfaces';
import { getSecretProviderInstance } from '../../../core/secretProvider';
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
      resource: `${mailboxBase}/mailFolders/inbox/messages`,
      resolvedFolder: 'Inbox (well-known)',
    };

    const requested = (desiredFolder || 'Inbox').trim();
    if (!requested) {
      return fallbackResult;
    }

    // Prefer Graph "well-known folder names" (path segment) over display names.
    // This avoids issues where default folders are localized or not resolved by display name.
    const wellKnownMap: Record<string, string> = {
      inbox: 'inbox',
      archive: 'archive',
      drafts: 'drafts',
      deleteditems: 'deleteditems',
      junkemail: 'junkemail',
      sentitems: 'sentitems',
      outbox: 'outbox',
      conversationhistory: 'conversationhistory',
      clutter: 'clutter',
      conflicts: 'conflicts',
      localfailures: 'localfailures',
      serverfailures: 'serverfailures',
      syncissues: 'syncissues',
    };

    const normalizedKey = requested.toLowerCase().replace(/\s+/g, '');
    if (wellKnownMap[normalizedKey]) {
      return {
        resource: `${mailboxBase}/mailFolders/${wellKnownMap[normalizedKey]}/messages`,
        resolvedFolder: `${requested} (well-known)`,
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
        return {
          resource: `${mailboxBase}/mailFolders/${encodeURIComponent(String(match.id))}/messages`,
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
        scope: 'https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Read.Shared offline_access',
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
        status: (enriched as any).status,
        code: (enriched as any).code,
        requestId: (enriched as any).requestId,
        responseBody: (enriched as any).responseBody,
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
      const enriched = this.handleError(error, 'renewWebhookSubscription');
      this.log('error', 'Subscription renewal failed', {
        message: enriched.message,
        context: 'renewWebhookSubscription',
        subscriptionId: this.config.webhook_subscription_id,
        status: (enriched as any).status,
        code: (enriched as any).code,
        requestId: (enriched as any).requestId,
        responseBody: (enriched as any).responseBody,
      });
      throw enriched;
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
          isInline: attachment.isInline,
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
   * Download a file attachment's bytes.
   *
   * Notes:
   * - Graph's attachment payload commonly includes base64 `contentBytes` for fileAttachment.
   * - We intentionally skip item/reference attachments here; callers can treat them as unsupported.
   */
  async downloadAttachmentBytes(messageId: string, attachmentId: string): Promise<{
    fileName: string;
    contentType: string;
    size: number;
    contentId?: string;
    isInline?: boolean;
    buffer: Buffer;
  }> {
    try {
      const mailboxBase = this.getMailboxBasePath();
      const response = await this.httpClient.get(
        `${mailboxBase}/messages/${messageId}/attachments/${attachmentId}`
      );

      const att = response.data;
      const odataType: string | undefined = att?.['@odata.type'];
      const isFileAttachment = !odataType || String(odataType).toLowerCase().includes('fileattachment');
      if (!isFileAttachment) {
        throw new Error(`Unsupported attachment type: ${odataType || 'unknown'}`);
      }

      const contentBytes: string | undefined = att?.contentBytes;
      if (!contentBytes) {
        throw new Error('Attachment contentBytes missing');
      }

      const buffer = Buffer.from(contentBytes, 'base64');
      return {
        fileName: att?.name || attachmentId,
        contentType: att?.contentType || 'application/octet-stream',
        size: typeof att?.size === 'number' ? att.size : buffer.length,
        contentId: att?.contentId || undefined,
        isInline: typeof att?.isInline === 'boolean' ? att.isInline : undefined,
        buffer,
      };
    } catch (error) {
      throw this.handleError(error, 'downloadAttachmentBytes');
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

  private buildTokenFingerprint(token?: string): string | undefined {
    if (!token) return undefined;
    return `${token.slice(0, 4)}...(${token.length})`;
  }

  private decodeJwtPayload(token: string): Record<string, any> | null {
    try {
      const parts = token.split('.');
      if (parts.length < 2) return null;
      const payload = parts[1];
      const padded = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
      const json = Buffer.from(padded, 'base64').toString('utf8');
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  private extractGraphIds(headers: any): { requestId?: string; clientRequestId?: string } {
    const lower = (k: string) => (headers?.[k] ?? headers?.[k.toLowerCase()]);
    return {
      requestId: lower('request-id'),
      clientRequestId: lower('client-request-id'),
    };
  }

  private classifyGraphFailure(error: any): {
    status?: number;
    code?: string;
    message: string;
    requestId?: string;
    clientRequestId?: string;
    responseBody?: unknown;
  } {
    const res = error?.response;
    const status = res?.status;
    const graphErr = res?.data?.error || res?.data;
    const message =
      graphErr?.message ||
      error?.message ||
      (typeof error === 'string' ? error : 'Unknown error');
    const code = graphErr?.code || (status ? String(status) : undefined);
    const ids = this.extractGraphIds(res?.headers);
    return {
      status,
      code,
      message,
      requestId: ids.requestId,
      clientRequestId: ids.clientRequestId,
      responseBody: res?.data,
    };
  }

  private mapRecommendations(args: {
    status?: number;
    code?: string;
    message: string;
    missingScopes?: string[];
  }): string[] {
    const recs: string[] = [];

    if (args.missingScopes?.length) {
      recs.push(
        `Missing delegated scopes in the access token: ${args.missingScopes.join(', ')}. Re-authorize with Mail.Read and Mail.Read.Shared (and ensure admin consent if required).`
      );
    }

    if (args.status === 401) {
      recs.push('Microsoft authorization appears invalid/expired. Re-authorize the Microsoft provider to refresh consent and tokens.');
    }

    if (args.status === 403) {
      recs.push(
        'Microsoft Graph returned 403 (Forbidden). Verify the user has delegated access to the target mailbox/folder and that Mail.Read/Mail.Read.Shared consent was granted.'
      );
    }

    if (args.status === 404) {
      const msg = (args.message || '').toLowerCase();
      if (msg.includes('default folder inbox not found') || msg.includes('specified object was not found in the store')) {
        recs.push(
          'Graph reports the mailbox store/folder is missing. Confirm the address is a real user/shared mailbox (not a group/contact) and that the mailbox is provisioned (can be opened in Outlook/OWA).'
        );
      } else {
        recs.push('Graph returned 404 (Not Found). Verify the mailbox address is correct for this tenant, and the folder exists and is accessible.');
      }
    }

    if (args.status === 429) {
      recs.push('Microsoft Graph throttled the request (429). Wait and retry; consider reducing repeated diagnostics runs.');
    }

    return recs;
  }

  private computeOverallStatus(steps: Microsoft365DiagnosticsStep[]): DiagnosticsStepStatus {
    if (steps.some((s) => s.status === 'fail')) return 'fail';
    if (steps.some((s) => s.status === 'warn')) return 'warn';
    return 'pass';
  }

  /**
   * Run a structured Microsoft 365 diagnostics checklist for this provider.
   *
   * NOTE: This is intended for admin self-serve troubleshooting. It always redacts secrets,
   * and (optionally) performs a live create+delete subscription test.
   */
  async runMicrosoft365Diagnostics(options: Microsoft365DiagnosticsOptions = {}): Promise<Microsoft365DiagnosticsReport> {
    const startedAt = new Date().toISOString();
    const steps: Microsoft365DiagnosticsStep[] = [];
    const recommendations = new Set<string>();

    const requiredScopes = options.requiredScopes?.length
      ? options.requiredScopes
      : ['Mail.Read', 'Mail.Read.Shared'];

    const folderListTop = Math.max(1, Math.min(options.folderListTop ?? 100, 250));

    const addStep = (step: Microsoft365DiagnosticsStep) => steps.push(step);

    const runStep = async (id: string, title: string, fn: () => Promise<Omit<Microsoft365DiagnosticsStep, 'id' | 'title' | 'startedAt' | 'durationMs'>>): Promise<void> => {
      const stepStarted = Date.now();
      const stepIso = new Date().toISOString();
      try {
        const partial = await fn();
        addStep({
          id,
          title,
          startedAt: stepIso,
          durationMs: Date.now() - stepStarted,
          status: partial.status,
          http: partial.http,
          data: partial.data,
          error: partial.error,
        });
      } catch (e: any) {
        const classified = this.classifyGraphFailure(e);
        this.mapRecommendations({ ...classified, missingScopes: undefined }).forEach((r) => recommendations.add(r));
        addStep({
          id,
          title,
          startedAt: stepIso,
          durationMs: Date.now() - stepStarted,
          status: 'fail',
          error: {
            message: classified.message,
            status: classified.status,
            code: classified.code,
            requestId: classified.requestId,
            clientRequestId: classified.clientRequestId,
            responseBody: classified.responseBody,
          },
        });
      }
    };

    // Step: load credentials (tokens present)
    await runStep('tokens_present', 'Load stored OAuth tokens', async () => {
      try {
        await this.loadCredentials();
        return {
          status: 'pass' as const,
          data: {
            accessToken: this.buildTokenFingerprint(this.accessToken),
            refreshToken: this.buildTokenFingerprint(this.refreshToken),
            tokenExpiresAt: this.tokenExpiresAt?.toISOString(),
          },
        };
      } catch (e: any) {
        const msg = e?.message || 'Microsoft OAuth tokens not found. Please complete authorization.';
        recommendations.add('No Microsoft OAuth tokens are available for this provider. Re-authorize the Microsoft provider to generate tokens.');
        return {
          status: 'fail' as const,
          error: { message: msg },
        };
      }
    });

    // If tokens didn't load, we can't proceed.
    if (!this.accessToken) {
      const report: Microsoft365DiagnosticsReport = {
        createdAt: startedAt,
        summary: {
          providerId: this.config.id,
          tenantId: this.config.tenant,
          providerType: 'microsoft',
          mailbox: this.config.mailbox,
          folder: (this.config.folder_to_monitor || 'Inbox').trim() || 'Inbox',
          mailboxBasePath: this.getMailboxBasePath(),
          notificationUrl: this.config.webhook_notification_url,
          targetResource: undefined,
          authenticatedUserEmail: undefined,
          tokenExpiresAt: this.tokenExpiresAt?.toISOString(),
          overallStatus: this.computeOverallStatus(steps),
        },
        steps,
        recommendations: Array.from(recommendations),
        supportBundle: {
          createdAt: startedAt,
          providerId: this.config.id,
          tenantId: this.config.tenant,
          providerType: 'microsoft',
          tokens: { accessToken: this.buildTokenFingerprint(this.accessToken), refreshToken: this.buildTokenFingerprint(this.refreshToken) },
          steps,
          recommendations: Array.from(recommendations),
        },
      };
      return report;
    }

    // Step: decode token claims + scope check
    let decodedScopes: string[] = [];
    await runStep('token_claims', 'Decode access token claims and scopes', async () => {
      const payload = this.decodeJwtPayload(this.accessToken!);
      const scp = typeof payload?.scp === 'string' ? payload!.scp : '';
      decodedScopes = scp ? scp.split(' ').filter(Boolean) : [];

      const missing = requiredScopes.filter((s) => !decodedScopes.includes(s));
      this.mapRecommendations({ status: undefined, code: undefined, message: '', missingScopes: missing }).forEach((r) => recommendations.add(r));

      return {
        status: missing.length ? ('warn' as const) : ('pass' as const),
        data: {
          tid: payload?.tid,
          aud: payload?.aud,
          iss: payload?.iss,
          appid: payload?.appid,
          upn: payload?.upn,
          preferred_username: payload?.preferred_username,
          scp: decodedScopes,
        },
      };
    });

    // Step: /me baseline
    await runStep('graph_me', 'Microsoft Graph /me baseline check', async () => {
      const clientRequestId = randomUUID();
      const res = await this.httpClient.get('/me', {
        params: { $select: 'id,userPrincipalName,mail' },
        headers: { 'client-request-id': clientRequestId, 'return-client-request-id': 'true' },
      });
      const ids = this.extractGraphIds(res.headers);
      this.authenticatedUserEmail = res.data?.userPrincipalName || res.data?.mail;
      return {
        status: 'pass' as const,
        http: {
          method: 'GET',
          path: '/me?$select=id,userPrincipalName,mail',
          status: res.status,
          requestId: ids.requestId,
          clientRequestId: ids.clientRequestId || clientRequestId,
        },
        data: {
          id: res.data?.id,
          userPrincipalName: res.data?.userPrincipalName,
          mail: res.data?.mail,
        },
      };
    });

    const mailboxBase = this.getMailboxBasePath();
    await runStep('mailbox_base_path', 'Compute mailbox base path decision', async () => {
      const configured = (this.config.mailbox || '').trim();
      const authenticated = (this.authenticatedUserEmail || '').trim();
      const decision = mailboxBase;
      const rationale =
        !configured
          ? 'No mailbox configured; defaulting to /me'
          : authenticated && configured.toLowerCase() === authenticated.toLowerCase()
            ? 'Configured mailbox matches authenticated user; using /me'
            : 'Configured mailbox differs from authenticated user; using /users/{mailbox}';

      return {
        status: 'pass' as const,
        data: {
          configuredMailbox: configured,
          authenticatedUserEmail: authenticated || undefined,
          mailboxBasePath: decision,
          rationale,
        },
      };
    });

    // Step: /users/{mailbox} directory existence (only when using /users)
    await runStep('mailbox_directory', 'Validate mailbox directory object (only for shared/delegated)', async () => {
      if (mailboxBase === '/me') {
        return { status: 'skip' as const, data: { reason: 'Using /me; no /users lookup required.' } };
      }

      const clientRequestId = randomUUID();
      const res = await this.httpClient.get(mailboxBase, {
        params: { $select: 'id,userPrincipalName,mail' },
        headers: { 'client-request-id': clientRequestId, 'return-client-request-id': 'true' },
      });
      const ids = this.extractGraphIds(res.headers);
      return {
        status: 'pass' as const,
        http: {
          method: 'GET',
          path: `${mailboxBase}?$select=id,userPrincipalName,mail`,
          status: res.status,
          requestId: ids.requestId,
          clientRequestId: ids.clientRequestId || clientRequestId,
        },
        data: {
          id: res.data?.id,
          userPrincipalName: res.data?.userPrincipalName,
          mail: res.data?.mail,
        },
      };
    });

    // Step: inbox well-known folder check
    await runStep('inbox_well_known', 'Validate well-known Inbox folder exists', async () => {
      const clientRequestId = randomUUID();
      const path = `${mailboxBase}/mailFolders/inbox`;
      const res = await this.httpClient.get(path, {
        params: { $select: 'id,displayName' },
        headers: { 'client-request-id': clientRequestId, 'return-client-request-id': 'true' },
      });
      const ids = this.extractGraphIds(res.headers);
      return {
        status: 'pass' as const,
        http: {
          method: 'GET',
          path: `${path}?$select=id,displayName`,
          status: res.status,
          requestId: ids.requestId,
          clientRequestId: ids.clientRequestId || clientRequestId,
        },
        data: {
          id: res.data?.id,
          displayName: res.data?.displayName,
        },
      };
    });

    // Step: folder enumeration (used for troubleshooting and custom folder resolution)
    let folders: Array<{ id: string; displayName?: string }> = [];
    await runStep('folder_list', 'List top-level mail folders', async () => {
      const clientRequestId = randomUUID();
      const path = `${mailboxBase}/mailFolders`;
      const res = await this.httpClient.get(path, {
        params: { $select: 'id,displayName', $top: folderListTop },
        headers: { 'client-request-id': clientRequestId, 'return-client-request-id': 'true' },
      });
      const ids = this.extractGraphIds(res.headers);
      folders = (res.data?.value || []).map((f: any) => ({ id: String(f.id), displayName: f.displayName }));
      return {
        status: 'pass' as const,
        http: {
          method: 'GET',
          path: `${path}?$select=id,displayName&$top=${folderListTop}`,
          status: res.status,
          requestId: ids.requestId,
          clientRequestId: ids.clientRequestId || clientRequestId,
        },
        data: {
          count: folders.length,
          truncated: folders.length >= folderListTop,
          sample: folders.slice(0, 25),
        },
      };
    });

    // Step: resolve configured folder to a resource
    const configuredFolder = (this.config.folder_to_monitor || 'Inbox').trim() || 'Inbox';
    let targetResource: string | undefined;
    await runStep('folder_resolve', 'Resolve configured folder to a Graph resource', async () => {
      const { resource, resolvedFolder } = await this.buildFolderResourcePath(configuredFolder);
      targetResource = resource;

      // If the configured folder is not Inbox and we couldn't find it in the folder list, warn.
      const normalized = configuredFolder.toLowerCase();
      const hasMatch =
        normalized === 'inbox' ||
        folders.some((f) => (f.displayName || '').toLowerCase() === normalized);

      if (!hasMatch && normalized !== 'inbox') {
        recommendations.add(`Configured folder '${configuredFolder}' was not found in the top-level folder list. Consider choosing a valid folder name.`);
      }

      return {
        status: 'pass' as const,
        data: {
          configuredFolder,
          resolvedFolder,
          targetResource: resource,
        },
      };
    });

    // Step: preflight read from the exact resource we will subscribe to
    await runStep('messages_preflight', 'Preflight message read for target resource', async () => {
      if (!targetResource) {
        return { status: 'fail' as const, error: { message: 'Target resource was not resolved' } };
      }
      const clientRequestId = randomUUID();
      const res = await this.httpClient.get(`${targetResource}`, {
        params: { $top: 1, $select: 'id,receivedDateTime,subject' },
        headers: { 'client-request-id': clientRequestId, 'return-client-request-id': 'true' },
      });
      const ids = this.extractGraphIds(res.headers);
      return {
        status: 'pass' as const,
        http: {
          method: 'GET',
          path: `${targetResource}?$top=1&$select=id,receivedDateTime,subject`,
          status: res.status,
          requestId: ids.requestId,
          clientRequestId: ids.clientRequestId || clientRequestId,
          resource: targetResource,
        },
        data: {
          messagesReadable: true,
          sampleCount: Array.isArray(res.data?.value) ? res.data.value.length : undefined,
        },
      };
    });

    // Step: live subscription create+delete test (optional, default enabled for admin diagnostics)
    await runStep('subscription_live_test', 'Live subscription create+delete test', async () => {
      if (!options.liveSubscriptionTest) {
        return { status: 'skip' as const, data: { reason: 'Disabled by options' } };
      }

      const webhookUrl = this.config.webhook_notification_url;
      if (!webhookUrl) {
        recommendations.add('Webhook notification URL is not configured. Save provider settings and ensure a public base URL is configured.');
        return { status: 'fail' as const, error: { message: 'Webhook notification URL not configured' } };
      }
      if (!targetResource) {
        return { status: 'fail' as const, error: { message: 'Target resource was not resolved' } };
      }

      const createClientRequestId = randomUUID();
      const subscriptionClientState = `diag-${randomUUID()}`;
      const createPayload = {
        changeType: 'created',
        notificationUrl: webhookUrl,
        resource: targetResource,
        expirationDateTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        clientState: subscriptionClientState,
        latestSupportedTlsVersion: 'v1_2',
      };

      let subscriptionId: string | undefined;
      try {
        const createRes = await this.httpClient.post('/subscriptions', createPayload, {
          headers: { 'client-request-id': createClientRequestId, 'return-client-request-id': 'true' },
        });
        const ids = this.extractGraphIds(createRes.headers);
        subscriptionId = createRes.data?.id;

        // Best-effort delete to avoid leaving residual subscriptions
        const deleteClientRequestId = randomUUID();
        try {
          const delRes = await this.httpClient.delete(`/subscriptions/${encodeURIComponent(String(subscriptionId))}`, {
            headers: { 'client-request-id': deleteClientRequestId, 'return-client-request-id': 'true' },
          });
          const delIds = this.extractGraphIds(delRes.headers);
          return {
            status: 'pass' as const,
            http: {
              method: 'POST',
              path: '/subscriptions',
              status: createRes.status,
              requestId: ids.requestId,
              clientRequestId: ids.clientRequestId || createClientRequestId,
              resource: targetResource,
            },
            data: {
              createdSubscriptionId: subscriptionId,
              deletedSubscriptionId: subscriptionId,
              deleteRequestId: delIds.requestId,
              deleteClientRequestId: delIds.clientRequestId || deleteClientRequestId,
            },
          };
        } catch (deleteErr: any) {
          const classified = this.classifyGraphFailure(deleteErr);
          recommendations.add(
            `Subscription created (${subscriptionId}) but deletion failed. You may need to manually clean up the subscription in Microsoft 365; Graph request-id: ${classified.requestId || 'unknown'}.`
          );
          return {
            status: 'warn' as const,
            http: {
              method: 'POST',
              path: '/subscriptions',
              status: createRes.status,
              requestId: ids.requestId,
              clientRequestId: ids.clientRequestId || createClientRequestId,
              resource: targetResource,
            },
            data: {
              createdSubscriptionId: subscriptionId,
              deleteFailed: true,
            },
            error: {
              message: classified.message,
              status: classified.status,
              code: classified.code,
              requestId: classified.requestId,
              clientRequestId: classified.clientRequestId,
              responseBody: classified.responseBody,
            },
          };
        }
      } catch (createErr: any) {
        const classified = this.classifyGraphFailure(createErr);
        this.mapRecommendations({ ...classified, missingScopes: undefined }).forEach((r) => recommendations.add(r));
        return {
          status: 'fail' as const,
          http: {
            method: 'POST',
            path: '/subscriptions',
            clientRequestId: createClientRequestId,
            resource: targetResource,
          },
          error: {
            message: classified.message,
            status: classified.status,
            code: classified.code,
            requestId: classified.requestId,
            clientRequestId: classified.clientRequestId || createClientRequestId,
            responseBody: classified.responseBody,
          },
        };
      }
    });

    // Build final report
    const summaryMailbox = options.includeIdentifiers ? this.config.mailbox : 'redacted';
    const summaryNotificationUrl = options.includeIdentifiers ? this.config.webhook_notification_url : undefined;
    const summaryTargetResource = options.includeIdentifiers ? targetResource : undefined;

    const report: Microsoft365DiagnosticsReport = {
      createdAt: startedAt,
      summary: {
        providerId: this.config.id,
        tenantId: this.config.tenant,
        providerType: 'microsoft',
        mailbox: summaryMailbox,
        folder: configuredFolder,
        mailboxBasePath: mailboxBase,
        notificationUrl: summaryNotificationUrl,
        targetResource: summaryTargetResource,
        authenticatedUserEmail: options.includeIdentifiers ? this.authenticatedUserEmail : undefined,
        tokenExpiresAt: this.tokenExpiresAt?.toISOString(),
        overallStatus: this.computeOverallStatus(steps),
      },
      steps,
      recommendations: Array.from(recommendations),
      supportBundle: {
        createdAt: startedAt,
        providerId: this.config.id,
        tenantId: this.config.tenant,
        mailbox: summaryMailbox,
        folder: configuredFolder,
        mailboxBasePath: mailboxBase,
        notificationUrl: summaryNotificationUrl,
        targetResource: summaryTargetResource,
        authenticatedUserEmail: options.includeIdentifiers ? this.authenticatedUserEmail : undefined,
        token: {
          accessToken: this.buildTokenFingerprint(this.accessToken),
          refreshToken: this.buildTokenFingerprint(this.refreshToken),
          tokenExpiresAt: this.tokenExpiresAt?.toISOString(),
          decodedScopes,
        },
        steps,
        recommendations: Array.from(recommendations),
      },
    };

    return report;
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
      const enriched = this.handleError(error, 'initializeWebhook');
      this.log('error', 'Subscription creation failed (initializeWebhook)', {
        message: enriched.message,
        context: 'initializeWebhook',
        status: (enriched as any).status,
        code: (enriched as any).code,
        requestId: (enriched as any).requestId,
        responseBody: (enriched as any).responseBody,
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
