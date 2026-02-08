'use server'

import { createTenantKnex } from '@alga-psa/db';
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
import { auditLog } from '@alga-psa/db';
import { EmailProviderService } from '../../services/email/EmailProviderService';
import { configureGmailProvider, type ConfigureGmailProviderResult } from './configureGmailProvider';
import { EmailWebhookMaintenanceService } from '@alga-psa/shared/services/email/EmailWebhookMaintenanceService';
import { hasPermission } from '@alga-psa/auth/rbac';
import { getWebhookBaseUrl } from '../../utils/email/webhookHelpers';

function throwPermissionError(action: string): never {
  throw new Error(`Permission denied: ${action}`);
}
import { MicrosoftGraphAdapter } from '@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter';
import type { Microsoft365DiagnosticsReport } from '@alga-psa/shared/interfaces/microsoft365-diagnostics.interfaces';

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
    redirect_uri: await secretProvider.getAppSecret('MICROSOFT_REDIRECT_URI') || 'https://api.algapsa.com/api/auth/microsoft/callback'
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
  'mailbox',
  'is_active as isActive',
  'status',
  'last_sync_at as lastSyncAt',
  'error_message as errorMessage',
  'inbound_ticket_defaults_id as inboundTicketDefaultsId',
  'created_at as createdAt',
  'updated_at as updatedAt'
];


/**
 * Create or update a provider record
 */
async function getOrCreateProvider(
  trx: any,
  tenant: string,
  data: {
    providerType: string;
    providerName: string;
    mailbox: string;
    isActive: boolean;
    inboundTicketDefaultsId?: string;
  },
  providerId?: string
) {
  if (providerId) {
    // Update existing provider by ID
    const [provider] = await trx('email_providers')
      .where({ id: providerId, tenant })
      .update({
        provider_type: data.providerType,
        provider_name: data.providerName,
        mailbox: data.mailbox,
        is_active: data.isActive,
        inbound_ticket_defaults_id: data.inboundTicketDefaultsId || null,
        updated_at: trx.fn.now()
      })
      .returning(PROVIDER_COLUMNS);

    if (!provider) {
      throw new Error('Provider not found');
    }
    return provider;
  } else {
    // Check if provider already exists by mailbox
    const existingProvider = await trx('email_providers')
      .where({ tenant, mailbox: data.mailbox })
      .first();

    if (existingProvider) {
      // Update existing provider
      const [provider] = await trx('email_providers')
        .where({ tenant, mailbox: data.mailbox })
        .update({
          provider_type: data.providerType,
          provider_name: data.providerName,
          is_active: data.isActive,
          inbound_ticket_defaults_id: data.inboundTicketDefaultsId || null,
          updated_at: trx.fn.now()
        })
        .returning(PROVIDER_COLUMNS);
      return provider;
    } else {
      // Create new provider
      const providerId = trx.raw('gen_random_uuid()');
      const [provider] = await trx('email_providers')
        .insert({
          id: providerId,
          tenant,
          provider_type: data.providerType,
          provider_name: data.providerName,
          mailbox: data.mailbox,
          is_active: data.isActive,
          status: 'configuring',
          inbound_ticket_defaults_id: data.inboundTicketDefaultsId || null,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now()
        })
        .returning(PROVIDER_COLUMNS);
      return provider;
    }
  }
}

/**
 * Persist Microsoft email provider configuration
 */
async function persistMicrosoftConfig(
  trx: any,
  tenant: string,
  providerId: string,
  config?: Omit<MicrosoftEmailProviderConfig, 'email_provider_id' | 'tenant' | 'created_at' | 'updated_at'>
) {
  if (!config) return null;
  if (!tenant) throw new Error('Tenant is required');

  // Check if we should use hosted configuration for Enterprise Edition
  const hostedConfig = await getHostedMicrosoftConfig();

  // Save secrets to tenant-specific secret store
  const secretProvider = await getSecretProviderInstance();
  
  // Use hosted credentials if available, otherwise use user-provided credentials
  const effectiveClientId = hostedConfig?.client_id || config.client_id;
  const effectiveClientSecret = hostedConfig?.client_secret || config.client_secret;
  const effectiveTenantId = hostedConfig?.tenant_id || config.tenant_id;
  const effectiveRedirectUri = hostedConfig?.redirect_uri || config.redirect_uri;
  
  // Ensure required fields are not undefined
  if (!effectiveTenantId) {
    throw new Error('Tenant ID is required for Microsoft configuration');
  }
  if (!effectiveRedirectUri) {
    throw new Error('Redirect URI is required for Microsoft configuration');
  }
  
  if (effectiveClientId && typeof effectiveClientId === 'string' && !hostedConfig?.client_id) {
    // Only store user-provided secrets, not hosted ones
    await secretProvider.setTenantSecret(tenant, 'microsoft_client_id', effectiveClientId);
  }
  if (effectiveClientSecret && typeof effectiveClientSecret === 'string' && !hostedConfig?.client_secret) {
    // Only store user-provided secrets, not hosted ones
    await secretProvider.setTenantSecret(tenant, 'microsoft_client_secret', effectiveClientSecret);
  }
  
  // Upsert config while preserving existing sensitive/webhook fields when incoming values are NULL
  const msConfig = await trx.raw(`
    INSERT INTO microsoft_email_provider_config (
      email_provider_id, tenant, client_id, client_secret, tenant_id, redirect_uri,
      auto_process_emails, max_emails_per_sync, folder_filters,
      access_token, refresh_token, token_expires_at,
      webhook_subscription_id, webhook_expires_at, webhook_verification_token,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (email_provider_id, tenant) DO UPDATE SET
      client_id = EXCLUDED.client_id,
      client_secret = EXCLUDED.client_secret,
      tenant_id = EXCLUDED.tenant_id,
      redirect_uri = EXCLUDED.redirect_uri,
      auto_process_emails = EXCLUDED.auto_process_emails,
      max_emails_per_sync = EXCLUDED.max_emails_per_sync,
      folder_filters = EXCLUDED.folder_filters,
      -- Preserve existing sensitive values if the new value is NULL
      access_token = COALESCE(EXCLUDED.access_token, microsoft_email_provider_config.access_token),
      refresh_token = COALESCE(EXCLUDED.refresh_token, microsoft_email_provider_config.refresh_token),
      token_expires_at = COALESCE(EXCLUDED.token_expires_at, microsoft_email_provider_config.token_expires_at),
      -- Preserve existing webhook linkage if the new value is NULL
      webhook_subscription_id = COALESCE(EXCLUDED.webhook_subscription_id, microsoft_email_provider_config.webhook_subscription_id),
      webhook_expires_at = COALESCE(EXCLUDED.webhook_expires_at, microsoft_email_provider_config.webhook_expires_at),
      webhook_verification_token = COALESCE(EXCLUDED.webhook_verification_token, microsoft_email_provider_config.webhook_verification_token),
      updated_at = EXCLUDED.updated_at
    RETURNING *
  `, [
    providerId,
    tenant,
    effectiveClientId || null,
    effectiveClientSecret || null,
    effectiveTenantId,
    effectiveRedirectUri,
    config.auto_process_emails,
    config.max_emails_per_sync,
    JSON.stringify(config.folder_filters || []),
    config.access_token || null,
    config.refresh_token || null,
    config.token_expires_at || null,
    null, // webhook_subscription_id (preserve existing if null)
    null, // webhook_expires_at (preserve existing if null)
    null  // webhook_verification_token (preserve existing if null)
  ]).then((result: any) => result.rows[0]);
  
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
) {
  if (!config) return null;
  if (!tenant) throw new Error('Tenant is required');

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
    throw new Error('Google OAuth is not configured for this tenant. Configure Google settings first.');
  }
  if (!effectiveProjectId) {
    throw new Error('Google Cloud project ID is not configured for this tenant. Configure Google settings first.');
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
  
  const googleConfig = await trx.raw(`
    INSERT INTO google_email_provider_config (
      email_provider_id, tenant, client_id, client_secret, project_id, redirect_uri,
      pubsub_topic_name, pubsub_subscription_name, auto_process_emails, max_emails_per_sync,
      label_filters, access_token, refresh_token, token_expires_at, history_id,
      watch_expiration, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (email_provider_id, tenant) DO UPDATE SET
      client_id = EXCLUDED.client_id,
      client_secret = EXCLUDED.client_secret,
      project_id = EXCLUDED.project_id,
      redirect_uri = EXCLUDED.redirect_uri,
      pubsub_topic_name = EXCLUDED.pubsub_topic_name,
      pubsub_subscription_name = EXCLUDED.pubsub_subscription_name,
      auto_process_emails = EXCLUDED.auto_process_emails,
      max_emails_per_sync = EXCLUDED.max_emails_per_sync,
      label_filters = EXCLUDED.label_filters,
      -- Preserve existing sensitive values if the new value is NULL
      access_token = COALESCE(EXCLUDED.access_token, google_email_provider_config.access_token),
      refresh_token = COALESCE(EXCLUDED.refresh_token, google_email_provider_config.refresh_token),
      token_expires_at = COALESCE(EXCLUDED.token_expires_at, google_email_provider_config.token_expires_at),
      history_id = COALESCE(EXCLUDED.history_id, google_email_provider_config.history_id),
      watch_expiration = COALESCE(EXCLUDED.watch_expiration, google_email_provider_config.watch_expiration),
      updated_at = EXCLUDED.updated_at
    RETURNING *
  `, [
    providerId, 
    tenant, 
    configPayload.client_id, 
    configPayload.client_secret,
    configPayload.project_id, 
    configPayload.redirect_uri, 
    configPayload.pubsub_topic_name,
    configPayload.pubsub_subscription_name, 
    configPayload.auto_process_emails,
    configPayload.max_emails_per_sync, 
    configPayload.label_filters,
    configPayload.access_token || null, 
    configPayload.refresh_token || null, 
    configPayload.token_expires_at || null,
    configPayload.history_id || null, 
    configPayload.watch_expiration || null
  ]).then((result: any) => result.rows[0]);
  
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
) {
  if (!config) return null;
  if (!tenant) throw new Error('Tenant is required');

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

  const imapConfig = await trx.raw(`
    INSERT INTO imap_email_provider_config (
      email_provider_id, tenant, host, port, secure, allow_starttls, auth_type, username,
      auto_process_emails, max_emails_per_sync, folder_filters,
      oauth_authorize_url, oauth_token_url, oauth_client_id, oauth_client_secret, oauth_scopes,
      access_token, refresh_token, token_expires_at,
      uid_validity, last_uid, last_seen_at, last_sync_at, last_error,
	      connection_timeout_ms, socket_keepalive,
	      created_at, updated_at
	    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
	    ON CONFLICT (email_provider_id, tenant) DO UPDATE SET
	      host = EXCLUDED.host,
	      port = EXCLUDED.port,
	      secure = EXCLUDED.secure,
      allow_starttls = EXCLUDED.allow_starttls,
      auth_type = EXCLUDED.auth_type,
      username = EXCLUDED.username,
      auto_process_emails = EXCLUDED.auto_process_emails,
      max_emails_per_sync = EXCLUDED.max_emails_per_sync,
      folder_filters = EXCLUDED.folder_filters,
      oauth_authorize_url = EXCLUDED.oauth_authorize_url,
      oauth_token_url = EXCLUDED.oauth_token_url,
      oauth_client_id = EXCLUDED.oauth_client_id,
      oauth_client_secret = EXCLUDED.oauth_client_secret,
      oauth_scopes = EXCLUDED.oauth_scopes,
      connection_timeout_ms = COALESCE(EXCLUDED.connection_timeout_ms, imap_email_provider_config.connection_timeout_ms),
      socket_keepalive = COALESCE(EXCLUDED.socket_keepalive, imap_email_provider_config.socket_keepalive),
      -- Preserve existing sensitive values if the new value is NULL
      access_token = COALESCE(EXCLUDED.access_token, imap_email_provider_config.access_token),
      refresh_token = COALESCE(EXCLUDED.refresh_token, imap_email_provider_config.refresh_token),
      token_expires_at = COALESCE(EXCLUDED.token_expires_at, imap_email_provider_config.token_expires_at),
      uid_validity = COALESCE(EXCLUDED.uid_validity, imap_email_provider_config.uid_validity),
      last_uid = COALESCE(EXCLUDED.last_uid, imap_email_provider_config.last_uid),
      last_seen_at = COALESCE(EXCLUDED.last_seen_at, imap_email_provider_config.last_seen_at),
      last_sync_at = COALESCE(EXCLUDED.last_sync_at, imap_email_provider_config.last_sync_at),
      last_error = COALESCE(EXCLUDED.last_error, imap_email_provider_config.last_error),
      updated_at = EXCLUDED.updated_at
    RETURNING *
  `, [
    providerId,
    tenant,
    config.host,
    config.port,
    config.secure ?? true,
    config.allow_starttls ?? false,
    config.auth_type,
    config.username,
    config.auto_process_emails ?? true,
    maxEmailsPerSync,
    JSON.stringify(folderFiltersArray),
    config.oauth_authorize_url || null,
    config.oauth_token_url || null,
    config.oauth_client_id || null,
    config.oauth_client_secret || null,
    config.oauth_scopes || null,
    config.access_token || null,
    config.refresh_token || null,
    config.token_expires_at || null,
    config.uid_validity || null,
    config.last_uid || null,
    config.last_seen_at || null,
    config.last_sync_at || null,
    config.last_error || null,
    connectionTimeoutMs,
    socketKeepalive
  ]).then((result: any) => result.rows[0]);

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
  
  try {
    const providers = await knex('email_providers')
      .where({ tenant })
      .orderBy('created_at', 'desc')
      .select(PROVIDER_COLUMNS);

    // Load vendor-specific configs
    const providersWithConfig = await Promise.all(providers.map(async (provider) => {
      if (provider.providerType === 'microsoft') {
        const msConfig = await knex('microsoft_email_provider_config')
          .where({ email_provider_id: provider.id, tenant })
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
        const googleConfig = await knex('google_email_provider_config')
          .where({ email_provider_id: provider.id, tenant })
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
        const imapConfig = await knex('imap_email_provider_config')
          .where({ email_provider_id: provider.id, tenant })
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
  mailbox: string;
  isActive: boolean;
  inboundTicketDefaultsId?: string;
  microsoftConfig?: Omit<MicrosoftEmailProviderConfig, 'email_provider_id' | 'tenant' | 'created_at' | 'updated_at'>;
  googleConfig?: Omit<GoogleEmailProviderConfig, 'email_provider_id' | 'tenant' | 'created_at' | 'updated_at'>;
  imapConfig?: Omit<ImapEmailProviderConfig, 'email_provider_id' | 'tenant' | 'created_at' | 'updated_at'>;
},
  skipAutomation?: boolean
): Promise<EmailProviderSetupResult> => {
  const { knex } = await createTenantKnex();

  const result: EmailProviderSetupResult = {
    provider: null as any,
    setupWarnings: []
  };

  try {
    const provider = await knex.transaction(async (trx) => {
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
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Failed to initialize Microsoft webhook:', error);
        // Record the error so the UI can display it
        result.setupError = `Failed to initialize Microsoft webhook: ${errorMessage}`;
        provider.status = 'error';
      }
    }

    return result;
  } catch (error) {
    console.error('Failed to upsert email provider:', error);
    throw new Error('Failed to upsert email provider');
  }
});

export const createEmailProvider = withAuth(async (
  user,
  { tenant },
  data: {
  tenant: string;
  providerType: string;
  providerName: string;
  mailbox: string;
  isActive: boolean;
  inboundTicketDefaultsId?: string;
  microsoftConfig?: Omit<MicrosoftEmailProviderConfig, 'email_provider_id' | 'tenant' | 'created_at' | 'updated_at'>;
  googleConfig?: Omit<GoogleEmailProviderConfig, 'email_provider_id' | 'tenant' | 'created_at' | 'updated_at'>;
  imapConfig?: Omit<ImapEmailProviderConfig, 'email_provider_id' | 'tenant' | 'created_at' | 'updated_at'>;
},
  skipAutomation?: boolean
): Promise<EmailProviderSetupResult> => {
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
    mailbox: string;
    isActive: boolean;
    inboundTicketDefaultsId?: string;
    microsoftConfig?: Omit<MicrosoftEmailProviderConfig, 'email_provider_id' | 'tenant' | 'created_at' | 'updated_at'>;
    googleConfig?: Omit<GoogleEmailProviderConfig, 'email_provider_id' | 'tenant' | 'created_at' | 'updated_at'>;
    imapConfig?: Omit<ImapEmailProviderConfig, 'email_provider_id' | 'tenant' | 'created_at' | 'updated_at'>;
  },
  skipAutomation?: boolean
): Promise<EmailProviderSetupResult> => {
  const { knex } = await createTenantKnex();

  const result: EmailProviderSetupResult = {
    provider: null as any,
    setupWarnings: []
  };

  try {
    const provider = await knex.transaction(async (trx) => {
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
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Failed to initialize Microsoft webhook:', error);
        // Record the error so the UI can display it
        result.setupError = `Failed to initialize Microsoft webhook: ${errorMessage}`;
        provider.status = 'error';
      }
    }

    return result;
  } catch (error) {
    console.error('Failed to update email provider:', error);
    throw new Error('Failed to update email provider');
  }
});

export const deleteEmailProvider = withAuth(async (
  _user,
  { tenant },
  providerId: string
): Promise<void> => {
  const { knex } = await createTenantKnex();
  
  try {
    const result = await knex('email_providers')
      .where({ id: providerId, tenant })
      .delete();

    if (result === 0) {
      throw new Error('Provider not found');
    }
  } catch (error) {
    console.error('Failed to delete email provider:', error);
    throw new Error('Failed to delete email provider');
  }
});

export const resyncImapProvider = withAuth(async (
  _user,
  { tenant },
  providerId: string
): Promise<{ success: boolean; error?: string }> => {
  const { knex } = await createTenantKnex();

  try {
    const provider = await knex('email_providers')
      .where({ id: providerId, tenant, provider_type: 'imap' })
      .first();

    if (!provider) {
      throw new Error('IMAP provider not found');
    }

    await knex('imap_email_provider_config')
      .where({ email_provider_id: providerId, tenant })
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

    await knex('email_providers')
      .where({ id: providerId, tenant })
      .update({
        status: 'disconnected',
        error_message: null,
        updated_at: knex.fn.now(),
      });

    return { success: true };
  } catch (error) {
    console.error('IMAP resync failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to resync IMAP provider'
    };
  }
});

export const testEmailProviderConnection = withAuth(async (
  _user,
  { tenant },
  providerId: string
): Promise<{ success: boolean; error?: string }> => {
  const { knex: baseKnex } = await createTenantKnex();
  const knex = baseKnex as any;
  
  try {
    const provider = await knex('email_providers')
      .where({ id: providerId, tenant })
      .first();

    if (!provider) {
      throw new Error('Provider not found');
    }

    if (provider.provider_type === 'imap') {
      const config = await knex('imap_email_provider_config')
        .where({ email_provider_id: providerId, tenant })
        .first();

      if (!config) {
        throw new Error('IMAP provider config not found');
      }

      const secretProvider = await getSecretProviderInstance();
      let accessToken = config.access_token;

      if (config.auth_type === 'oauth2') {
        if (!accessToken || (config.token_expires_at && new Date(config.token_expires_at).getTime() < Date.now() + 5 * 60 * 1000)) {
          if (!config.oauth_token_url || !config.oauth_client_id) {
            throw new Error('IMAP OAuth token configuration missing');
          }
          const secretRefreshToken = await secretProvider.getTenantSecret(tenant, `imap_refresh_token_${providerId}` as string);
          const refreshToken = secretRefreshToken || config.refresh_token;
          if (!refreshToken) {
            throw new Error('IMAP OAuth refresh token missing');
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

          const response = await axios.post(config.oauth_token_url, params as any, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
          });

          accessToken = response.data.access_token;
          const expiresIn = Number(response.data.expires_in || 3600);
          const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

          await knex('imap_email_provider_config')
            .where({ email_provider_id: providerId, tenant })
            .update({
              access_token: accessToken,
              token_expires_at: expiresAt,
              updated_at: knex.fn.now(),
            });
        }
      }

      const auth: any = { user: config.username };
      if (config.auth_type === 'oauth2') {
        auth.accessToken = accessToken;
      } else {
        const passwordSecret = await secretProvider.getTenantSecret(tenant, `imap_password_${providerId}` as string);
        const password = passwordSecret || undefined;
        if (password) {
          auth.pass = password;
        }
      }

      if (!auth.pass && !auth.accessToken) {
        throw new Error('IMAP credentials missing');
      }

      const client = new ImapFlow({
        host: config.host,
        port: Number(config.port),
        secure: config.secure,
        auth,
        disableAutoIdle: true,
        logger: false,
      });

      await client.connect();
      await client.logout();
    }

    await knex('email_providers')
      .where({ id: providerId })
      .update({
        status: 'connected',
        last_sync_at: knex.fn.now(),
        updated_at: knex.fn.now()
      });

    return { success: true };
  } catch (error) {
    console.error('Connection test failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Connection test failed'
    };
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
    return { success: false, message: error.message || 'Internal server error' };
  }
});

export const runMicrosoft365Diagnostics = withAuth(async (
  user,
  { tenant },
  providerId: string
): Promise<{ success: boolean; report?: Microsoft365DiagnosticsReport; error?: string }> => {
  try {
    const { knex } = await createTenantKnex();

    const permitted = await hasPermission(user, 'ticket_settings', 'update', knex);
    if (!permitted) {
      throwPermissionError('run Microsoft 365 diagnostics');
    }

    const provider = await knex('email_providers')
      .where({ id: providerId, tenant })
      .first();

    if (!provider) {
      return { success: false, error: 'Provider not found' };
    }

    if (provider.provider_type !== 'microsoft') {
      return { success: false, error: 'Diagnostics are only available for Microsoft 365 providers' };
    }

    const vendorConfig = await knex('microsoft_email_provider_config')
      .where({ email_provider_id: providerId, tenant })
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

    const adapter = new MicrosoftGraphAdapter(adapterConfig as any);

    const report = await adapter.runMicrosoft365Diagnostics({
      includeIdentifiers: true,
      liveSubscriptionTest: true,
      requiredScopes: ['Mail.Read', 'Mail.Read.Shared'],
      folderListTop: 100,
    });

    return { success: true, report };
  } catch (error: any) {
    return { success: false, error: error?.message || 'Failed to run diagnostics' };
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
//         effectiveRedirectUri = await secretProvider.getAppSecret('GOOGLE_REDIRECT_URI') || 'https://api.algapsa.com/api/auth/google/callback';
//       } else if (params.provider === 'microsoft') {
//         clientId = await secretProvider.getAppSecret('MICROSOFT_CLIENT_ID') || null;
//         effectiveRedirectUri = await secretProvider.getAppSecret('MICROSOFT_REDIRECT_URI') || 'https://api.algapsa.com/api/auth/microsoft/callback';
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
