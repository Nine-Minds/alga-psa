'use server'

import { auditLog, createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import type { IUserWithRoles } from '@alga-psa/types';
import type {
  EmailProvider,
  GoogleEmailProviderConfig,
  ImapEmailProviderConfig,
  MicrosoftEmailProviderConfig,
} from '../../components/email/types';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { setupPubSub } from './setupPubSub';
import { ImapFlow } from 'imapflow';
import axios from 'axios';
import { EmailProviderService } from '../../services/email/EmailProviderService';
import { configureGmailProvider, type ConfigureGmailProviderResult } from './configureGmailProvider';
import { EmailWebhookMaintenanceService } from '@alga-psa/shared/services/email/EmailWebhookMaintenanceService';
import { hasPermission } from '@alga-psa/auth/rbac';
import { getWebhookBaseUrl } from '../../utils/email/webhookHelpers';
import {
  actionError,
  type ActionMessageError,
} from '@alga-psa/ui/lib/errorHandling';
import { MicrosoftGraphAdapter } from '@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter';
import type { Microsoft365DiagnosticsReport } from '@alga-psa/shared/interfaces/microsoft365-diagnostics.interfaces';
import { buildMicrosoftEmailProviderConfig } from '@alga-psa/shared/services/email/microsoftEmailProviderConfig';
import { resolveMicrosoftConsumerProfileConfig } from '../../lib/microsoftConsumerProfileResolution';

type EmailProviderActionError = ActionMessageError;
type EmailProviderSetupActionResult = EmailProviderSetupResult | EmailProviderActionError;
type EmailProviderOperationErrorCode =
  | 'not_found'
  | 'missing_config'
  | 'missing_credentials'
  | 'oauth_refresh_failed'
  | 'connection_failed'
  | 'unexpected';
type EmailProviderOperationResult = {
  success: boolean;
  error?: string;
  errorCode?: EmailProviderOperationErrorCode;
};

class ExpectedEmailProviderActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpectedEmailProviderActionError';
  }
}

function throwExpectedEmailProviderError(message: string): never {
  throw new ExpectedEmailProviderActionError(message);
}

function emailProviderOperationError(
  error: string,
  errorCode: EmailProviderOperationErrorCode
): EmailProviderOperationResult {
  return { success: false, error, errorCode };
}

function mapImapConnectionFailure(error: unknown): EmailProviderOperationResult {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (
    message.includes('auth') ||
    message.includes('credential') ||
    message.includes('login') ||
    message.includes('invalid_grant') ||
    message.includes('unauthorized')
  ) {
    return emailProviderOperationError(
      'IMAP authentication failed. Check the mailbox credentials or reconnect OAuth, then try again.',
      'connection_failed'
    );
  }

  return emailProviderOperationError(
    'Could not connect to the IMAP mailbox. Check the server settings and try again.',
    'connection_failed'
  );
}

function microsoft365ActionErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  if (message === 'Provider not found') {
    return message;
  }

  if (
    lowerMessage.includes('auth') ||
    lowerMessage.includes('credential') ||
    lowerMessage.includes('invalid_grant') ||
    lowerMessage.includes('refresh token') ||
    lowerMessage.includes('unauthorized') ||
    lowerMessage.includes('401')
  ) {
    return 'Microsoft 365 authentication failed. Reconnect the mailbox and try again.';
  }

  if (
    lowerMessage.includes('permission') ||
    lowerMessage.includes('scope') ||
    lowerMessage.includes('consent') ||
    lowerMessage.includes('forbidden') ||
    lowerMessage.includes('403')
  ) {
    return 'Microsoft 365 permissions are insufficient. Reconnect with the required permissions and try again.';
  }

  if (
    lowerMessage.includes('webhook') ||
    lowerMessage.includes('subscription') ||
    lowerMessage.includes('notification url')
  ) {
    return 'Microsoft webhook setup failed. Check the webhook URL and Microsoft 365 permissions, then try again.';
  }

  return fallback;
}

function applyOauthMechanismOverride(client: ImapFlow, mechanism: 'XOAUTH2' | 'OAUTHBEARER'): void {
  if (mechanism !== 'XOAUTH2') return;

  const anyClient = client as any;
  const commands: Map<string, any> | undefined = anyClient.commands;
  if (!commands?.get) return;

  const originalAuthenticate = commands.get('AUTHENTICATE');
  if (typeof originalAuthenticate !== 'function') return;

  const patchedCommands = new Map(commands);
  patchedCommands.set('AUTHENTICATE', async (connection: any, username: string, authOpts: any) => {
    if (authOpts?.accessToken) {
      const caps = connection?.capabilities;
      const hadOauthBearer = Boolean(caps?.has?.('AUTH=OAUTHBEARER'));
      const hasXoauth = Boolean(caps?.has?.('AUTH=XOAUTH') || caps?.has?.('AUTH=XOAUTH2'));

      if (hadOauthBearer && hasXoauth && caps?.delete && caps?.set) {
        caps.delete('AUTH=OAUTHBEARER');
        try {
          return await originalAuthenticate(connection, username, authOpts);
        } finally {
          caps.set('AUTH=OAUTHBEARER', true);
        }
      }
    }

    return await originalAuthenticate(connection, username, authOpts);
  });

  anyClient.commands = patchedCommands;
}

export interface EmailProviderSetupResult {
  provider: EmailProvider;
  setupError?: string;
  setupWarnings?: string[];
}


/**
 * Generate standardized Pub/Sub topic and subscription names for a tenant
 */
async function generatePubSubNames(tenantId: string) {
  // Use ngrok URL in development if available
  const secretProvider = await getSecretProviderInstance();
  const baseUrl = await secretProvider.getAppSecret('NGROK_URL') || 
                  await secretProvider.getAppSecret('NEXT_PUBLIC_BASE_URL') || 
                  await secretProvider.getAppSecret('NEXTAUTH_URL') ||
                  'http://localhost:3000';
  
  return {
    topicName: `gmail-notifications-${tenantId}`,
    subscriptionName: `gmail-webhook-${tenantId}`,
    webhookUrl: `${baseUrl}/api/email/webhooks/google`
  };
}

/**
 * Get hosted Microsoft configuration for Enterprise Edition
 */
export async function getHostedMicrosoftConfig() {
  const secretProvider = await getSecretProviderInstance();
  
  return {
    client_id: await secretProvider.getAppSecret('MICROSOFT_CLIENT_ID'),
    client_secret: await secretProvider.getAppSecret('MICROSOFT_CLIENT_SECRET'),
    tenant_id: await secretProvider.getAppSecret('MICROSOFT_TENANT_ID') || 'common',
    redirect_uri: await secretProvider.getAppSecret('MICROSOFT_REDIRECT_URI') || 'https://algapsa.com/api/auth/microsoft/callback'
  };
}

/**
 * Shared column list for provider queries
 */
const PROVIDER_COLUMNS = [
  'id',
  'tenant',
  'provider_type as providerType',
  'provider_name as providerName',
  'sender_display_name as senderDisplayName',
  'mailbox',
  'is_active as isActive',
  'status',
  'last_sync_at as lastSyncAt',
  'error_message as errorMessage',
  'inbound_ticket_defaults_id as inboundTicketDefaultsId',
  'created_at as createdAt',
  'updated_at as updatedAt'
];

type ProviderRow = EmailProvider;


/**
 * Create or update a provider record
 */
async function getOrCreateProvider(
  trx: any,
  tenant: string,
  data: {
    providerType: string;
    providerName: string;
    senderDisplayName?: string | null;
    mailbox: string;
    isActive: boolean;
    inboundTicketDefaultsId?: string;
  },
  providerId?: string
): Promise<EmailProvider> {
  const senderDisplayName = normalizeSenderDisplayName(data.senderDisplayName);
  const providerTable = () => tenantDb(trx, tenant).table('email_providers');

  if (providerId) {
    // Update existing provider by ID
    const providerRows = await providerTable()
      .where({ id: providerId })
      .update({
        provider_type: data.providerType,
        provider_name: data.providerName,
        sender_display_name: senderDisplayName,
        mailbox: data.mailbox,
        is_active: data.isActive,
        inbound_ticket_defaults_id: data.inboundTicketDefaultsId || null,
        updated_at: trx.fn.now()
      })
      .returning(PROVIDER_COLUMNS) as unknown as ProviderRow[];
    const [provider] = providerRows;

    if (!provider) {
      throwExpectedEmailProviderError('Email provider not found');
    }
    return provider;
  } else {
    // Check if provider already exists by mailbox
    const existingProvider = await providerTable()
      .where({ mailbox: data.mailbox })
      .first();

    if (existingProvider) {
      // Update existing provider
      const providerRows = await providerTable()
        .where({ mailbox: data.mailbox })
        .update({
          provider_type: data.providerType,
          provider_name: data.providerName,
          sender_display_name: senderDisplayName,
          is_active: data.isActive,
          inbound_ticket_defaults_id: data.inboundTicketDefaultsId || null,
          updated_at: trx.fn.now()
        })
        .returning(PROVIDER_COLUMNS) as unknown as ProviderRow[];
      const [provider] = providerRows;
      return provider;
    } else {
      // Create new provider
      const providerId = trx.raw('gen_random_uuid()');
      const providerRows = await providerTable()
        .insert({
          id: providerId,
          tenant,
          provider_type: data.providerType,
          provider_name: data.providerName,
          sender_display_name: senderDisplayName,
          mailbox: data.mailbox,
          is_active: data.isActive,
          status: 'configuring',
          inbound_ticket_defaults_id: data.inboundTicketDefaultsId || null,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now()
        })
        .returning(PROVIDER_COLUMNS) as unknown as ProviderRow[];
      const [provider] = providerRows;
      return provider;
    }
  }
}

// Reject control chars, double-quote, and angle brackets — these can break the
// `"Name" <email>` formatting downstream and enable header injection if the
// value reaches an outbound mail header. Server-side guard mirrors the form
// schema; clients with a stale schema or a non-form caller still get rejected.
const SENDER_DISPLAY_NAME_FORBIDDEN = /[\x00-\x1F\x7F"<>]/;

function normalizeSenderDisplayName(value?: string | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 255) {
    throwExpectedEmailProviderError('Sender display name cannot exceed 255 characters');
  }
  if (SENDER_DISPLAY_NAME_FORBIDDEN.test(trimmed)) {
    throwExpectedEmailProviderError('Sender display name cannot contain quotes, angle brackets, or line breaks');
  }
  return trimmed;
}

/**
 * Persist Microsoft email provider configuration
 */
async function persistMicrosoftConfig(
  trx: any,
  tenant: string,
  providerId: string,
  config?: Omit<MicrosoftEmailProviderConfig, 'email_provider_id' | 'tenant' | 'created_at' | 'updated_at'>
): Promise<MicrosoftEmailProviderConfig | undefined> {
  if (!config) return undefined;
  if (!tenant) throwExpectedEmailProviderError('Tenant context is required to save Microsoft email configuration');

  const microsoftProfile = await resolveMicrosoftConsumerProfileConfig(tenant, 'email');
  if (microsoftProfile.status !== 'ready') {
    throwExpectedEmailProviderError(
      microsoftProfile.message || 'Microsoft Email profile is not configured'
    );
  }

  const effectiveClientId = microsoftProfile.clientId || '';
  const effectiveClientSecret = microsoftProfile.clientSecret || '';
  const effectiveTenantId = microsoftProfile.microsoftTenantId || 'common';
  const effectiveRedirectUri = config.redirect_uri;
  
  // Ensure required fields are not undefined
  if (!effectiveTenantId) {
    throwExpectedEmailProviderError('Tenant ID is required for Microsoft configuration');
  }
  if (!effectiveRedirectUri) {
    throwExpectedEmailProviderError('Redirect URI is required for Microsoft configuration');
  }
  
  const now = new Date();
  const existingConfig = await tenantDb(trx, tenant)
    .table('microsoft_email_provider_config')
    .where({ email_provider_id: providerId })
    .first();
  const preserveIssuingApp = Boolean(existingConfig?.refresh_token && !config.refresh_token);
  const pinnedClientId = preserveIssuingApp ? existingConfig.client_id : effectiveClientId;
  const pinnedClientSecret = preserveIssuingApp ? existingConfig.client_secret : effectiveClientSecret;
  const pinnedProfileId = preserveIssuingApp
    ? existingConfig.microsoft_profile_id
    : microsoftProfile.profileId || null;
  const pinnedClientSecretRef = preserveIssuingApp
    ? existingConfig.client_secret_ref
    : microsoftProfile.clientSecretRef || null;
  const pinnedTenantId = preserveIssuingApp ? existingConfig.tenant_id : effectiveTenantId;

  // Upsert config while preserving existing sensitive/webhook fields when incoming values are NULL
  const msConfigRows = await tenantDb(trx, tenant)
    .table('microsoft_email_provider_config')
    .insert({
      email_provider_id: providerId,
      tenant,
      client_id: pinnedClientId,
      client_secret: pinnedClientSecret,
      microsoft_profile_id: pinnedProfileId,
      client_secret_ref: pinnedClientSecretRef,
      tenant_id: pinnedTenantId,
      redirect_uri: effectiveRedirectUri,
      auto_process_emails: config.auto_process_emails,
      max_emails_per_sync: config.max_emails_per_sync,
      folder_filters: JSON.stringify(config.folder_filters || []),
      access_token: config.access_token || null,
      refresh_token: config.refresh_token || null,
      token_expires_at: config.token_expires_at || null,
      webhook_subscription_id: null,
      webhook_expires_at: null,
      webhook_verification_token: null,
      delivery_mode: 'polling',
      webhook_silent_runs: 0,
      next_subscription_probe_at: null,
      created_at: now,
      updated_at: now,
    })
    .onConflict(['email_provider_id', 'tenant'])
    .merge({
      // A settings save commonly has no new token. In that case retain the
      // credentials that issued the stored refresh token; switching the pin to
      // a newly-bound profile would make that token irredeemable.
      client_id: pinnedClientId,
      client_secret: pinnedClientSecret,
      microsoft_profile_id: pinnedProfileId,
      client_secret_ref: pinnedClientSecretRef,
      tenant_id: pinnedTenantId,
      redirect_uri: effectiveRedirectUri,
      auto_process_emails: config.auto_process_emails,
      max_emails_per_sync: config.max_emails_per_sync,
      folder_filters: JSON.stringify(config.folder_filters || []),
      access_token: trx.raw('COALESCE(EXCLUDED.access_token, microsoft_email_provider_config.access_token)'),
      refresh_token: trx.raw('COALESCE(EXCLUDED.refresh_token, microsoft_email_provider_config.refresh_token)'),
      token_expires_at: trx.raw('COALESCE(EXCLUDED.token_expires_at, microsoft_email_provider_config.token_expires_at)'),
      webhook_subscription_id: trx.raw(
        'COALESCE(EXCLUDED.webhook_subscription_id, microsoft_email_provider_config.webhook_subscription_id)'
      ),
      webhook_expires_at: trx.raw('COALESCE(EXCLUDED.webhook_expires_at, microsoft_email_provider_config.webhook_expires_at)'),
      webhook_verification_token: trx.raw(
        'COALESCE(EXCLUDED.webhook_verification_token, microsoft_email_provider_config.webhook_verification_token)'
      ),
      updated_at: now,
    })
    .returning('*') as unknown as MicrosoftEmailProviderConfig[];
  const [msConfig] = msConfigRows;
  
  if (msConfig) {
    // For jsonb columns, PostgreSQL automatically parses the JSON, so no need to JSON.parse
    msConfig.folder_filters = msConfig.folder_filters || [];
  }
  
  return msConfig;
}

/**
 * Persist Google email provider configuration
 */
async function persistGoogleConfig(
  trx: any,
  tenant: string,
  providerId: string,
  config?: Omit<GoogleEmailProviderConfig, 'email_provider_id' | 'tenant' | 'created_at' | 'updated_at'>
): Promise<GoogleEmailProviderConfig | undefined> {
  if (!config) return undefined;
  if (!tenant) throwExpectedEmailProviderError('Tenant context is required to save Google email configuration');

  // Google is always tenant-owned (CE and EE): credentials must come from tenant secrets.
  // We will not store OAuth client credentials in the DB.
  const secretProvider = await getSecretProviderInstance();

  // Allow a transitional path where config includes creds, but immediately persist them into tenant secrets.
  const tenantClientId = await secretProvider.getTenantSecret(tenant, 'google_client_id');
  const tenantClientSecret = await secretProvider.getTenantSecret(tenant, 'google_client_secret');

  const effectiveClientId = tenantClientId || config.client_id || null;
  const effectiveClientSecret = tenantClientSecret || config.client_secret || null;

  if (config.client_id && !tenantClientId) {
    await secretProvider.setTenantSecret(tenant, 'google_client_id', String(config.client_id).trim());
  }
  if (config.client_secret && !tenantClientSecret) {
    await secretProvider.setTenantSecret(tenant, 'google_client_secret', String(config.client_secret).trim());
  }

  const tenantProjectId = await secretProvider.getTenantSecret(tenant, 'google_project_id');
  const effectiveProjectId = tenantProjectId || config.project_id || null;
  if (config.project_id && !tenantProjectId) {
    await secretProvider.setTenantSecret(tenant, 'google_project_id', String(config.project_id).trim());
  }

  if (!effectiveClientId || !effectiveClientSecret) {
    throwExpectedEmailProviderError('Google OAuth is not configured for this tenant. Configure Google settings first.');
  }
  if (!effectiveProjectId) {
    throwExpectedEmailProviderError('Google Cloud project ID is not configured for this tenant. Configure Google settings first.');
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ||
    (await secretProvider.getAppSecret('NEXT_PUBLIC_BASE_URL')) ||
    process.env.NEXTAUTH_URL ||
    (await secretProvider.getAppSecret('NEXTAUTH_URL')) ||
    'http://localhost:3000';
  const effectiveRedirectUri = `${baseUrl}/api/auth/google/callback`;
  
  // Generate standardized Pub/Sub names
  const pubsubNames = await generatePubSubNames(tenant);
  
  // Prepare config payload
  const labelFiltersArray = config.label_filters || [];
  const configPayload = {
    email_provider_id: providerId,
    tenant,
    client_id: null,
    client_secret: null,
    project_id: effectiveProjectId,
    redirect_uri: effectiveRedirectUri,
    pubsub_topic_name: pubsubNames.topicName,
    pubsub_subscription_name: pubsubNames.subscriptionName,
    auto_process_emails: config.auto_process_emails,
    max_emails_per_sync: config.max_emails_per_sync,
    label_filters: JSON.stringify(labelFiltersArray),
    access_token: config.access_token,
    refresh_token: config.refresh_token,
    token_expires_at: config.token_expires_at,
    history_id: config.history_id,
    watch_expiration: config.watch_expiration,
    updated_at: trx.fn.now()
  };
  
  const now = new Date();

  const googleConfigRows = await tenantDb(trx, tenant)
    .table('google_email_provider_config')
    .insert({
      email_provider_id: providerId,
      tenant,
      client_id: configPayload.client_id,
      client_secret: configPayload.client_secret,
      project_id: configPayload.project_id,
      redirect_uri: configPayload.redirect_uri,
      pubsub_topic_name: configPayload.pubsub_topic_name,
      pubsub_subscription_name: configPayload.pubsub_subscription_name,
      auto_process_emails: configPayload.auto_process_emails,
      max_emails_per_sync: configPayload.max_emails_per_sync,
      label_filters: configPayload.label_filters,
      access_token: configPayload.access_token || null,
      refresh_token: configPayload.refresh_token || null,
      token_expires_at: configPayload.token_expires_at || null,
      history_id: configPayload.history_id || null,
      watch_expiration: configPayload.watch_expiration || null,
      created_at: now,
      updated_at: now,
    })
    .onConflict(['email_provider_id', 'tenant'])
    .merge({
      client_id: configPayload.client_id,
      client_secret: configPayload.client_secret,
      project_id: configPayload.project_id,
      redirect_uri: configPayload.redirect_uri,
      pubsub_topic_name: configPayload.pubsub_topic_name,
      pubsub_subscription_name: configPayload.pubsub_subscription_name,
      auto_process_emails: configPayload.auto_process_emails,
      max_emails_per_sync: configPayload.max_emails_per_sync,
      label_filters: configPayload.label_filters,
      access_token: trx.raw('COALESCE(EXCLUDED.access_token, google_email_provider_config.access_token)'),
      refresh_token: trx.raw('COALESCE(EXCLUDED.refresh_token, google_email_provider_config.refresh_token)'),
      token_expires_at: trx.raw('COALESCE(EXCLUDED.token_expires_at, google_email_provider_config.token_expires_at)'),
      history_id: trx.raw('COALESCE(EXCLUDED.history_id, google_email_provider_config.history_id)'),
      watch_expiration: trx.raw('COALESCE(EXCLUDED.watch_expiration, google_email_provider_config.watch_expiration)'),
      updated_at: now,
    })
    .returning('*') as unknown as GoogleEmailProviderConfig[];
  const [googleConfig] = googleConfigRows;
  
  if (googleConfig) {
    // For jsonb columns, PostgreSQL automatically parses the JSON, so no need to JSON.parse
    googleConfig.label_filters = googleConfig.label_filters || [];
  }
  
  return googleConfig;
}

/**
 * Persist IMAP email provider configuration
 */
async function persistImapConfig(
  trx: any,
  tenant: string,
  providerId: string,
  config?: Omit<ImapEmailProviderConfig, 'email_provider_id' | 'tenant' | 'created_at' | 'updated_at'>
): Promise<ImapEmailProviderConfig | undefined> {
  if (!config) return undefined;
  if (!tenant) throwExpectedEmailProviderError('Tenant context is required to save IMAP email configuration');

  const secretProvider = await getSecretProviderInstance();

  // IMAP runtime tuning is configured via env (not exposed in UI).
  const maxEmailsPerSync = Number(process.env.IMAP_MAX_EMAILS_PER_SYNC || 5);
  const connectionTimeoutMs = Number(process.env.IMAP_CONNECTION_TIMEOUT_MS || 10_000);
  const socketKeepalive = (process.env.IMAP_SOCKET_KEEPALIVE || 'true') !== 'false';

  if (config.password && typeof config.password === 'string') {
    await secretProvider.setTenantSecret(tenant, `imap_password_${providerId}`, config.password);
  }

  if (config.oauth_client_secret && typeof config.oauth_client_secret === 'string') {
    await secretProvider.setTenantSecret(tenant, `imap_oauth_client_secret_${providerId}`, config.oauth_client_secret);
  }

  if (config.refresh_token && typeof config.refresh_token === 'string') {
    await secretProvider.setTenantSecret(tenant, `imap_refresh_token_${providerId}`, config.refresh_token);
  }

  const folderFiltersArray = config.folder_filters || [];

  const now = new Date();

  const imapConfigRows = await tenantDb(trx, tenant)
    .table('imap_email_provider_config')
    .insert({
      email_provider_id: providerId,
      tenant,
      host: config.host,
      port: config.port,
      secure: config.secure ?? true,
      allow_starttls: config.allow_starttls ?? false,
      auth_type: config.auth_type,
      username: config.username,
      auto_process_emails: config.auto_process_emails ?? true,
      max_emails_per_sync: maxEmailsPerSync,
      folder_filters: JSON.stringify(folderFiltersArray),
      oauth_authorize_url: config.oauth_authorize_url || null,
      oauth_token_url: config.oauth_token_url || null,
      oauth_client_id: config.oauth_client_id || null,
      oauth_client_secret: config.oauth_client_secret || null,
      oauth_scopes: config.oauth_scopes || null,
      access_token: config.access_token || null,
      refresh_token: config.refresh_token || null,
      token_expires_at: config.token_expires_at || null,
      uid_validity: config.uid_validity || null,
      last_uid: config.last_uid || null,
      last_seen_at: config.last_seen_at || null,
      last_sync_at: config.last_sync_at || null,
      last_error: config.last_error || null,
      connection_timeout_ms: connectionTimeoutMs,
      socket_keepalive: socketKeepalive,
      created_at: now,
      updated_at: now,
    })
    .onConflict(['email_provider_id', 'tenant'])
    .merge({
      host: config.host,
      port: config.port,
      secure: config.secure ?? true,
      allow_starttls: config.allow_starttls ?? false,
      auth_type: config.auth_type,
      username: config.username,
      auto_process_emails: config.auto_process_emails ?? true,
      max_emails_per_sync: maxEmailsPerSync,
      folder_filters: JSON.stringify(folderFiltersArray),
      oauth_authorize_url: config.oauth_authorize_url || null,
      oauth_token_url: config.oauth_token_url || null,
      oauth_client_id: config.oauth_client_id || null,
      oauth_client_secret: config.oauth_client_secret || null,
      oauth_scopes: config.oauth_scopes || null,
      connection_timeout_ms: trx.raw('COALESCE(EXCLUDED.connection_timeout_ms, imap_email_provider_config.connection_timeout_ms)'),
      socket_keepalive: trx.raw('COALESCE(EXCLUDED.socket_keepalive, imap_email_provider_config.socket_keepalive)'),
      access_token: trx.raw('COALESCE(EXCLUDED.access_token, imap_email_provider_config.access_token)'),
      refresh_token: trx.raw('COALESCE(EXCLUDED.refresh_token, imap_email_provider_config.refresh_token)'),
      token_expires_at: trx.raw('COALESCE(EXCLUDED.token_expires_at, imap_email_provider_config.token_expires_at)'),
      uid_validity: trx.raw('COALESCE(EXCLUDED.uid_validity, imap_email_provider_config.uid_validity)'),
      last_uid: trx.raw('COALESCE(EXCLUDED.last_uid, imap_email_provider_config.last_uid)'),
      last_seen_at: trx.raw('COALESCE(EXCLUDED.last_seen_at, imap_email_provider_config.last_seen_at)'),
      last_sync_at: trx.raw('COALESCE(EXCLUDED.last_sync_at, imap_email_provider_config.last_sync_at)'),
      last_error: trx.raw('COALESCE(EXCLUDED.last_error, imap_email_provider_config.last_error)'),
      updated_at: now,
    })
    .returning('*') as unknown as ImapEmailProviderConfig[];
  const [imapConfig] = imapConfigRows;

  if (imapConfig) {
    imapConfig.folder_filters = imapConfig.folder_filters || [];
  }

  return imapConfig;
}

/**
 * Finalize Google provider setup with Pub/Sub and Gmail watch
 */

export const getEmailProviders = withAuth(async (
  _user,
  { tenant }
): Promise<{ providers: EmailProvider[] }> => {
  const { knex } = await createTenantKnex();
  const db = tenantDb(knex, tenant);
  
  try {
    const providers = await db.table('email_providers')
      .orderBy('created_at', 'desc')
      .select(PROVIDER_COLUMNS) as unknown as ProviderRow[];

    // Load vendor-specific configs
    const providersWithConfig = await Promise.all(providers.map(async (provider): Promise<EmailProvider> => {
      if (provider.providerType === 'microsoft') {
        const msConfig = await db.table('microsoft_email_provider_config')
          .where({ email_provider_id: provider.id })
          .select(
            'email_provider_id',
            'tenant',
            'client_id',
            'client_secret',
            'tenant_id',
            'redirect_uri',
            'auto_process_emails',
            'max_emails_per_sync',
            'folder_filters',
            'access_token',
            'refresh_token',
            'token_expires_at',
            'webhook_subscription_id',
            'webhook_expires_at',
            'webhook_verification_token',
            'last_subscription_renewal',
            'delivery_mode',
            'last_webhook_delivery_at',
            'webhook_silent_runs',
            'next_subscription_probe_at',
            'created_at',
            'updated_at'
          )
          .first();
        
        if (msConfig) {
          // For jsonb columns, PostgreSQL automatically parses the JSON, so no need to JSON.parse
          msConfig.folder_filters = msConfig.folder_filters || [];
          provider.microsoftConfig = msConfig;
        }
      } else if (provider.providerType === 'google') {
        const googleConfig = await db.table('google_email_provider_config')
          .where({ email_provider_id: provider.id })
          .select(
            'email_provider_id',
            'tenant',
            'client_id',
            'client_secret',
            'project_id',
            'redirect_uri',
            'pubsub_topic_name',
            'pubsub_subscription_name',
            'auto_process_emails',
            'max_emails_per_sync',
            'label_filters',
            'access_token',
            'refresh_token',
            'token_expires_at',
            'history_id',
            'watch_expiration',
            'created_at',
            'updated_at'
          )
          .first();
        
        if (googleConfig) {
          googleConfig.label_filters = googleConfig.label_filters || [];
          provider.googleConfig = googleConfig;
        }
      } else if (provider.providerType === 'imap') {
        const imapConfig = await db.table('imap_email_provider_config')
          .where({ email_provider_id: provider.id })
          .select(
            'email_provider_id',
            'tenant',
            'host',
            'port',
            'secure',
            'allow_starttls',
            'auth_type',
            'username',
            'auto_process_emails',
            'max_emails_per_sync',
            'folder_filters',
            'oauth_authorize_url',
            'oauth_token_url',
            'oauth_client_id',
            'oauth_client_secret',
            'oauth_scopes',
            'access_token',
            'refresh_token',
            'token_expires_at',
            'uid_validity',
            'last_uid',
            'folder_state',
            'last_processed_message_id',
            'server_capabilities',
            'lease_owner',
            'lease_expires_at',
            'connection_timeout_ms',
            'socket_keepalive',
            'last_seen_at',
            'last_sync_at',
            'last_error',
            'created_at',
            'updated_at'
          )
          .first();

        if (imapConfig) {
          imapConfig.folder_filters = imapConfig.folder_filters || [];
          provider.imapConfig = imapConfig;
        }
      }
      
      return provider;
    }));

    return { providers: providersWithConfig };
  } catch (error) {
    console.error('Failed to load email providers:', error);
    // Return empty array if table doesn't exist yet
    return { providers: [] };
  }
});

export const upsertEmailProvider = withAuth(async (
  user,
  { tenant },
  data: {
  tenant: string;
  providerType: string;
  providerName: string;
  senderDisplayName?: string | null;
  mailbox: string;
  isActive: boolean;
  inboundTicketDefaultsId?: string;
  microsoftConfig?: Omit<MicrosoftEmailProviderConfig, 'email_provider_id' | 'tenant' | 'created_at' | 'updated_at'>;
  googleConfig?: Omit<GoogleEmailProviderConfig, 'email_provider_id' | 'tenant' | 'created_at' | 'updated_at'>;
  imapConfig?: Omit<ImapEmailProviderConfig, 'email_provider_id' | 'tenant' | 'created_at' | 'updated_at'>;
},
  skipAutomation?: boolean
): Promise<EmailProviderSetupActionResult> => {
  const { knex } = await createTenantKnex();

  const result: EmailProviderSetupResult = {
    provider: null as any,
    setupWarnings: []
  };

  try {
    const provider = await knex.transaction(async (trx): Promise<EmailProvider> => {
      const base = await getOrCreateProvider(trx, tenant, data);

      if (data.providerType === 'microsoft') {
        base.microsoftConfig = await persistMicrosoftConfig(trx, tenant, base.id, data.microsoftConfig);
      } else if (data.providerType === 'google') {
        base.googleConfig = await persistGoogleConfig(trx, tenant, base.id, data.googleConfig);
      } else if (data.providerType === 'imap') {
        base.imapConfig = await persistImapConfig(trx, tenant, base.id, data.imapConfig);
        await auditLog(trx, {
          userId: user.user_id,
          operation: 'upsert',
          tableName: 'imap_email_provider_config',
          recordId: base.id,
          changedData: {
            auth_type: data.imapConfig?.auth_type,
            username: data.imapConfig?.username,
            folder_filters: data.imapConfig?.folder_filters,
          },
          details: {
            providerId: base.id,
            tenant,
          }
        });
      }

      return base;
    });

    result.provider = provider;

    if (!skipAutomation && data.providerType === 'google' && provider.googleConfig) {
      const secretProvider = await getSecretProviderInstance();
      const effectiveProjectId =
        (await secretProvider.getTenantSecret(tenant, 'google_project_id')) ||
        data.googleConfig?.project_id;

      if (effectiveProjectId) {
        const gmailResult = await configureGmailProvider({
          tenant,
          providerId: provider.id,
          projectId: effectiveProjectId
        });

        if (gmailResult.success) {
          // Update returned provider state to reflect side-effects
          provider.lastSyncAt = new Date().toISOString();
          provider.status = 'connected';
        } else {
          // Setup failed - record the error
          result.setupError = gmailResult.error || 'Gmail setup failed';
          provider.status = 'error';
        }

        // Add any warnings
        if (gmailResult.warnings && gmailResult.warnings.length > 0) {
          result.setupWarnings = [...(result.setupWarnings || []), ...gmailResult.warnings];
        }
      }
    }

    if (!skipAutomation && data.providerType === 'microsoft' && provider.microsoftConfig) {
      try {
        const service = new EmailProviderService();
        await service.initializeProviderWebhook(provider.id, tenant);
        // Update returned provider state to reflect side-effects
        provider.lastSyncAt = new Date().toISOString();
        provider.status = 'connected';
      } catch (error) {
        console.error('Failed to initialize Microsoft webhook:', error);
        // Record the error so the UI can display it
        result.setupError = microsoft365ActionErrorMessage(
          error,
          'Failed to initialize Microsoft webhook. Check Microsoft 365 settings and try again.'
        );
        provider.status = 'error';
      }
    }

    return result;
  } catch (error) {
    if (error instanceof ExpectedEmailProviderActionError) {
      return actionError(error.message);
    }
    console.error('Unexpected failure while upserting email provider:', error);
    return actionError('Failed to save email provider. Please review the settings and try again.');
  }
});

export const createEmailProvider = withAuth(async (
  user,
  { tenant },
  data: {
  tenant: string;
  providerType: string;
  providerName: string;
  senderDisplayName?: string | null;
  mailbox: string;
  isActive: boolean;
  inboundTicketDefaultsId?: string;
  microsoftConfig?: Omit<MicrosoftEmailProviderConfig, 'email_provider_id' | 'tenant' | 'created_at' | 'updated_at'>;
  googleConfig?: Omit<GoogleEmailProviderConfig, 'email_provider_id' | 'tenant' | 'created_at' | 'updated_at'>;
  imapConfig?: Omit<ImapEmailProviderConfig, 'email_provider_id' | 'tenant' | 'created_at' | 'updated_at'>;
},
  skipAutomation?: boolean
): Promise<EmailProviderSetupActionResult> => {
  // Delegate to upsertEmailProvider since they have identical logic
  return upsertEmailProvider(data, skipAutomation);
});

export const updateEmailProvider = withAuth(async (
  user,
  { tenant },
  providerId: string,
  data: {
    tenant: string;
    providerType: string;
    providerName: string;
    senderDisplayName?: string | null;
    mailbox: string;
    isActive: boolean;
    inboundTicketDefaultsId?: string;
    microsoftConfig?: Omit<MicrosoftEmailProviderConfig, 'email_provider_id' | 'tenant' | 'created_at' | 'updated_at'>;
    googleConfig?: Omit<GoogleEmailProviderConfig, 'email_provider_id' | 'tenant' | 'created_at' | 'updated_at'>;
    imapConfig?: Omit<ImapEmailProviderConfig, 'email_provider_id' | 'tenant' | 'created_at' | 'updated_at'>;
  },
  skipAutomation?: boolean
): Promise<EmailProviderSetupActionResult> => {
  const { knex } = await createTenantKnex();

  const result: EmailProviderSetupResult = {
    provider: null as any,
    setupWarnings: []
  };

  try {
    const provider = await knex.transaction(async (trx): Promise<EmailProvider> => {
      const base = await getOrCreateProvider(trx, tenant, data, providerId);

      if (data.providerType === 'microsoft') {
        base.microsoftConfig = await persistMicrosoftConfig(trx, tenant, base.id, data.microsoftConfig);
      } else if (data.providerType === 'google') {
        base.googleConfig = await persistGoogleConfig(trx, tenant, base.id, data.googleConfig);
      } else if (data.providerType === 'imap') {
        base.imapConfig = await persistImapConfig(trx, tenant, base.id, data.imapConfig);
        await auditLog(trx, {
          userId: user.user_id,
          operation: 'update',
          tableName: 'imap_email_provider_config',
          recordId: base.id,
          changedData: {
            auth_type: data.imapConfig?.auth_type,
            username: data.imapConfig?.username,
            folder_filters: data.imapConfig?.folder_filters,
          },
          details: {
            providerId: base.id,
            tenant,
          }
        });
      }

      return base;
    });

    result.provider = provider;

    if (!skipAutomation && data.providerType === 'google' && provider.googleConfig) {
      const secretProvider = await getSecretProviderInstance();
      const effectiveProjectId =
        (await secretProvider.getTenantSecret(tenant, 'google_project_id')) ||
        data.googleConfig?.project_id;

      if (effectiveProjectId) {
        const gmailResult = await configureGmailProvider({
          tenant,
          providerId: provider.id,
          projectId: effectiveProjectId
        });

        if (gmailResult.success) {
          // Update returned provider state to reflect side-effects
          provider.lastSyncAt = new Date().toISOString();
          provider.status = 'connected';
        } else {
          // Setup failed - record the error
          result.setupError = gmailResult.error || 'Gmail setup failed';
          provider.status = 'error';
        }

        // Add any warnings
        if (gmailResult.warnings && gmailResult.warnings.length > 0) {
          result.setupWarnings = [...(result.setupWarnings || []), ...gmailResult.warnings];
        }
      }
    }

    if (!skipAutomation && data.providerType === 'microsoft' && provider.microsoftConfig) {
      try {
        const service = new EmailProviderService();
        await service.initializeProviderWebhook(provider.id, tenant);
        // Update returned provider state to reflect side-effects
        provider.lastSyncAt = new Date().toISOString();
        provider.status = 'connected';
      } catch (error) {
        console.error('Failed to initialize Microsoft webhook:', error);
        // Record the error so the UI can display it
        result.setupError = microsoft365ActionErrorMessage(
          error,
          'Failed to initialize Microsoft webhook. Check Microsoft 365 settings and try again.'
        );
        provider.status = 'error';
      }
    }

    return result;
  } catch (error) {
    if (error instanceof ExpectedEmailProviderActionError) {
      return actionError(error.message);
    }
    console.error('Unexpected failure while updating email provider:', error);
    return actionError('Failed to update email provider. Please review the settings and try again.');
  }
});

export const deleteEmailProvider = withAuth(async (
  _user,
  { tenant },
  providerId: string
): Promise<{ success: true } | EmailProviderActionError> => {
  const { knex } = await createTenantKnex();
  const db = tenantDb(knex, tenant);

  const result = await db.table('email_providers')
    .where({ id: providerId })
    .delete();

  if (result === 0) {
    return actionError('Email provider not found');
  }

  return { success: true };
});

export const resyncImapProvider = withAuth(async (
  _user,
  { tenant },
  providerId: string
): Promise<EmailProviderOperationResult> => {
  const { knex } = await createTenantKnex();
  const db = tenantDb(knex, tenant);

  const provider = await db.table('email_providers')
    .where({ id: providerId, provider_type: 'imap' })
    .first();

  if (!provider) {
    return emailProviderOperationError('IMAP provider not found.', 'not_found');
  }

  try {
    await db.table('imap_email_provider_config')
      .where({ email_provider_id: providerId })
      .update({
        uid_validity: null,
        last_uid: null,
        last_processed_message_id: null,
        folder_state: {},
        last_error: null,
        lease_owner: null,
        lease_expires_at: null,
        updated_at: knex.fn.now(),
      });

    await db.table('email_providers')
      .where({ id: providerId })
      .update({
        status: 'disconnected',
        error_message: null,
        updated_at: knex.fn.now(),
      });

    return { success: true };
  } catch (error) {
    console.error('IMAP resync failed:', error);
    return emailProviderOperationError(
      'Failed to resync IMAP provider. Please try again.',
      'unexpected'
    );
  }
});

export const testEmailProviderConnection = withAuth(async (
  _user,
  { tenant },
  providerId: string
): Promise<EmailProviderOperationResult> => {
  const { knex: baseKnex } = await createTenantKnex();
  const knex = baseKnex as any;
  const db = tenantDb(knex, tenant);
  
  try {
    const provider = await db.table('email_providers')
      .where({ id: providerId })
      .first();

    if (!provider) {
      return emailProviderOperationError('Email provider not found.', 'not_found');
    }

    if (provider.provider_type === 'imap') {
      const config = await db.table('imap_email_provider_config')
        .where({ email_provider_id: providerId })
        .first();

      if (!config) {
        return emailProviderOperationError('IMAP provider configuration not found.', 'missing_config');
      }

      const secretProvider = await getSecretProviderInstance();
      let accessToken = config.access_token;

      if (config.auth_type === 'oauth2') {
        if (!accessToken || (config.token_expires_at && new Date(config.token_expires_at).getTime() < Date.now() + 5 * 60 * 1000)) {
          if (!config.oauth_token_url || !config.oauth_client_id) {
            return emailProviderOperationError(
              'IMAP OAuth token configuration is incomplete. Reconnect the mailbox and try again.',
              'missing_config'
            );
          }
          const secretRefreshToken = await secretProvider.getTenantSecret(tenant, `imap_refresh_token_${providerId}` as string);
          const refreshToken = secretRefreshToken || config.refresh_token;
          if (!refreshToken) {
            return emailProviderOperationError(
              'IMAP OAuth refresh token is missing. Reconnect the mailbox and try again.',
              'missing_credentials'
            );
          }

          const clientSecret = await secretProvider.getTenantSecret(tenant, `imap_oauth_client_secret_${providerId}` as string);
          const params = new URLSearchParams();
          params.append('grant_type', 'refresh_token');
          params.append('refresh_token', refreshToken as string);
          
          const oauthClientId = config.oauth_client_id || undefined;
          if (oauthClientId) {
            params.append('client_id', oauthClientId);
          }
          if (clientSecret) {
            params.append('client_secret', clientSecret as string);
          }

          let response;
          try {
            response = await axios.post(config.oauth_token_url, params as any, {
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
          } catch (oauthError) {
            console.warn('IMAP OAuth token refresh failed:', oauthError);
            return emailProviderOperationError(
              'IMAP OAuth token refresh failed. Reconnect the mailbox and try again.',
              'oauth_refresh_failed'
            );
          }

          accessToken = response.data.access_token;
          const expiresIn = Number(response.data.expires_in || 3600);
          const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

          await db.table('imap_email_provider_config')
            .where({ email_provider_id: providerId })
            .update({
              access_token: accessToken,
              token_expires_at: expiresAt,
              updated_at: knex.fn.now(),
            });
        }
      }

      const oauthMechanism = process.env.IMAP_OAUTH_AUTH_MECHANISM === 'OAUTHBEARER' ? 'OAUTHBEARER' : 'XOAUTH2';

      const auth: any = { user: config.username };
      if (config.auth_type === 'oauth2') {
        auth.accessToken = accessToken;
        auth.method = oauthMechanism;
      } else {
        const passwordSecret = await secretProvider.getTenantSecret(tenant, `imap_password_${providerId}` as string);
        const password = passwordSecret || undefined;
        if (password) {
          auth.pass = password;
        }
      }

      if (!auth.pass && !auth.accessToken) {
        return emailProviderOperationError(
          'IMAP credentials are missing. Add mailbox credentials or reconnect OAuth, then try again.',
          'missing_credentials'
        );
      }

      const client = new ImapFlow({
        host: config.host,
        port: Number(config.port),
        secure: config.secure,
        auth,
        disableAutoIdle: true,
        logger: false,
      });

      applyOauthMechanismOverride(client, oauthMechanism);

      try {
        await client.connect();
        await client.logout();
      } catch (connectionError) {
        console.warn('IMAP connection test failed:', connectionError);
        return mapImapConnectionFailure(connectionError);
      }
    }

    if (provider.provider_type === 'microsoft') {
      const vendorConfig = await db.table('microsoft_email_provider_config')
        .where({ email_provider_id: providerId })
        .first();
      if (!vendorConfig) {
        return emailProviderOperationError('Microsoft provider configuration not found.', 'missing_config');
      }

      const adapterConfig = await buildMicrosoftEmailProviderConfig({
        id: provider.id,
        tenant: provider.tenant,
        name: provider.provider_name || provider.mailbox,
        provider_type: 'microsoft',
        mailbox: provider.mailbox,
        folder_to_monitor: Array.isArray(vendorConfig.folder_filters)
          ? vendorConfig.folder_filters[0] || 'Inbox'
          : 'Inbox',
        active: provider.is_active,
        webhook_notification_url: `${getWebhookBaseUrl()}/api/email/webhooks/microsoft`,
        webhook_subscription_id: vendorConfig.webhook_subscription_id || undefined,
        webhook_verification_token: vendorConfig.webhook_verification_token || undefined,
        webhook_expires_at: vendorConfig.webhook_expires_at || undefined,
        connection_status: provider.status || 'disconnected',
        created_at: provider.created_at,
        updated_at: provider.updated_at,
        provider_config: vendorConfig,
      });
      const result = await new MicrosoftGraphAdapter(adapterConfig).testConnection();
      if (!result.success) {
        await db.table('email_providers').where({ id: providerId }).update({
          status: 'error',
          error_message: result.error || 'Microsoft connection test failed',
          updated_at: knex.fn.now(),
        });
        return emailProviderOperationError(
          'Microsoft 365 authentication failed. Reconnect the mailbox and try again.',
          'connection_failed'
        );
      }

      if (vendorConfig.delivery_mode === 'polling') {
        const [probeResult] = await new EmailWebhookMaintenanceService().renewMicrosoftWebhooks({
          tenantId: tenant,
          providerId,
          lookAheadMinutes: 0,
        });
        if (probeResult && !probeResult.success) {
          return emailProviderOperationError(
            probeResult.error || 'Microsoft webhook recovery probe failed.',
            'connection_failed'
          );
        }
      }
    }

    await db.table('email_providers')
      .where({ id: providerId })
      .update({
        status: 'connected',
        error_message: null,
        updated_at: knex.fn.now()
      });

    return { success: true };
  } catch (error) {
    console.error('Connection test failed:', error);
    return emailProviderOperationError(
      'Connection test failed. Please try again.',
      'unexpected'
    );
  }
});

/**
 * Manually retry Microsoft subscription renewal for a specific provider
 */
export const retryMicrosoftSubscriptionRenewal = withAuth(async (
  user,
  { tenant },
  providerId: string
): Promise<{ success: boolean; message?: string }> => {
  try {
    const service = new EmailWebhookMaintenanceService();
    const results = await service.renewMicrosoftWebhooks({
      tenantId: tenant,
      providerId: providerId,
      lookAheadMinutes: 0 // Force check regardless of expiration time
    });

    if (results.length === 0) {
      return { success: false, message: 'Provider not found or not eligible for renewal' };
    }

    const result = results[0];
    if (result.success) {
      return { success: true, message: `Subscription ${result.action} successfully` };
    } else {
      return { success: false, message: result.error || 'Renewal failed' };
    }
  } catch (error: any) {
    console.error('Manual renewal failed:', error);
    return {
      success: false,
      message: microsoft365ActionErrorMessage(error, 'Microsoft subscription renewal failed. Please try again.'),
    };
  }
});

export const runMicrosoft365Diagnostics = withAuth(async (
  user,
  { tenant },
  providerId: string
): Promise<{ success: boolean; report?: Microsoft365DiagnosticsReport; error?: string }> => {
  try {
    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, tenant);

    const permitted = await hasPermission(user, 'ticket_settings', 'update', knex);
    if (!permitted) {
      return { success: false, error: 'Permission denied: Cannot run Microsoft 365 diagnostics' };
    }

    const provider = await db.table('email_providers')
      .where({ id: providerId })
      .first();

    if (!provider) {
      return { success: false, error: 'Provider not found' };
    }

    if (provider.provider_type !== 'microsoft') {
      return { success: false, error: 'Diagnostics are only available for Microsoft 365 providers' };
    }

    const vendorConfig = await db.table('microsoft_email_provider_config')
      .where({ email_provider_id: providerId })
      .first();

    const baseUrl = getWebhookBaseUrl();
    const webhookUrl = `${baseUrl}/api/email/webhooks/microsoft`;

    const adapterConfig = {
      id: provider.id,
      tenant: provider.tenant,
      name: provider.provider_name,
      provider_type: 'microsoft' as const,
      mailbox: provider.mailbox,
      folder_to_monitor: 'Inbox',
      active: provider.is_active,
      webhook_notification_url: webhookUrl,
      webhook_subscription_id: vendorConfig?.webhook_subscription_id || null,
      webhook_verification_token: vendorConfig?.webhook_verification_token || null,
      webhook_expires_at: vendorConfig?.webhook_expires_at || null,
      last_subscription_renewal: vendorConfig?.last_subscription_renewal || null,
      connection_status: provider.status || 'configuring',
      last_connection_test: provider.last_sync_at || null,
      connection_error_message: provider.error_message || null,
      provider_config: vendorConfig || {},
      created_at: provider.created_at,
      updated_at: provider.updated_at,
    };

    const adapter = new MicrosoftGraphAdapter(
      await buildMicrosoftEmailProviderConfig(adapterConfig as any)
    );

    const report = await adapter.runMicrosoft365Diagnostics({
      includeIdentifiers: true,
      liveSubscriptionTest: true,
      requiredScopes: ['Mail.Read', 'Mail.Read.Shared'],
      folderListTop: 100,
    });

    return { success: true, report };
  } catch (error: any) {
    return {
      success: false,
      error: microsoft365ActionErrorMessage(error, 'Failed to run Microsoft 365 diagnostics. Please try again.'),
    };
  }
});

// Re-export setupPubSub from the actual implementation
// export { setupPubSub } from './setupPubSub';

/**
 * Initiate OAuth flow for email provider
 */
// export async function initiateOAuth(params: {
//   provider: 'google' | 'microsoft';
//   redirectUri?: string;
//   providerId?: string;
//   hosted?: boolean;
// }): Promise<{
//   success: boolean;
//   authUrl?: string;
//   error?: string;
// }> {
//   try {
//     const user = await assertAuthenticated();
    
//     if (!params.provider || !['microsoft', 'google'].includes(params.provider)) {
//       return { success: false, error: 'Invalid provider' };
//     }

//     // Import OAuth helpers
//     const { generateMicrosoftAuthUrl, generateGoogleAuthUrl, generateNonce } = await import('../../../utils/email/oauthHelpers');
//     type OAuthState = import('../../../utils/email/oauthHelpers').OAuthState;
    
//     // Get OAuth credentials - use hosted credentials for EE or tenant-specific secrets for CE
//     const secretProvider = await getSecretProviderInstance();
//     let clientId: string | null = null;
//     let effectiveRedirectUri = params.redirectUri;

//     // Prefer server-side NEXTAUTH_URL for hosted detection
//     const nextauthUrl = process.env.NEXTAUTH_URL || (await secretProvider.getAppSecret('NEXTAUTH_URL')) || '';
//     const isHosted = nextauthUrl.startsWith('https://algapsa.com');

//     if (isHosted) {
//       // Use app-level configuration
//       if (params.provider === 'google') {
//         clientId = await secretProvider.getAppSecret('GOOGLE_CLIENT_ID') || null;
//         effectiveRedirectUri = await secretProvider.getAppSecret('GOOGLE_REDIRECT_URI') || 'https://algapsa.com/api/auth/google/callback';
//       } else if (params.provider === 'microsoft') {
//         clientId = await secretProvider.getAppSecret('MICROSOFT_CLIENT_ID') || null;
//         effectiveRedirectUri = await secretProvider.getAppSecret('MICROSOFT_REDIRECT_URI') || 'https://algapsa.com/api/auth/microsoft/callback';
//       }
//     } else {
//       // Use tenant-specific or fallback credentials
//       clientId = params.provider === 'microsoft'
//         ? await secretProvider.getAppSecret('MICROSOFT_CLIENT_ID') || await secretProvider.getTenantSecret(user.tenant, 'microsoft_client_id') || null
//         : await secretProvider.getAppSecret('GOOGLE_CLIENT_ID') || await secretProvider.getTenantSecret(user.tenant, 'google_client_id') || null;
//     }

//     if (!clientId) {
//       return { 
//         success: false,
//         error: `${params.provider} OAuth client ID not configured` 
//       };
//     }

//     // Generate OAuth state
//     const state: OAuthState = {
//       tenant: user.tenant,
//       userId: user.user_id,
//       providerId: params.providerId,
//       redirectUri: effectiveRedirectUri || `${await secretProvider.getAppSecret('NEXT_PUBLIC_BASE_URL')}/api/auth/${params.provider}/callback`,
//       timestamp: Date.now(),
//       nonce: generateNonce(),
//       hosted: !!isHosted
//     };

//     // Generate authorization URL
//     const authUrl = params.provider === 'microsoft'
//       ? generateMicrosoftAuthUrl(
//           clientId,
//           state.redirectUri,
//           state
//         )
//       : generateGoogleAuthUrl(
//           clientId,
//           state.redirectUri,
//           state
//         );

//     return {
//       success: true,
//       authUrl
//     };

//   } catch (error: any) {
//     console.error('Error initiating OAuth:', error);
//     return { 
//       success: false, 
//       error: error.message || 'Failed to initiate OAuth' 
//     };
//   }
// }
