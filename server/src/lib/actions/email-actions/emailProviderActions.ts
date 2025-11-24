'use server'

import { createTenantKnex } from '../../db';
import { getCurrentUser } from '../user-actions/userActions';
import type { EmailProvider, MicrosoftEmailProviderConfig, GoogleEmailProviderConfig } from '../../../components/EmailProviderConfiguration';
import { getSecretProviderInstance } from '@shared/core';
import { setupPubSub } from './setupPubSub';
import { EmailProviderService } from '../../../services/email/EmailProviderService';
import { configureGmailProvider } from './configureGmailProvider';
import { EmailWebhookMaintenanceService } from '@alga-psa/shared/services/email/EmailWebhookMaintenanceService';


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
 * Get hosted Gmail configuration for Enterprise Edition
 */
export async function getHostedGmailConfig() {
  const secretProvider = await getSecretProviderInstance();
  
  return {
    client_id: await secretProvider.getAppSecret('GOOGLE_CLIENT_ID'),
    client_secret: await secretProvider.getAppSecret('GOOGLE_CLIENT_SECRET'),
    project_id: await secretProvider.getAppSecret('GOOGLE_PROJECT_ID'),
    redirect_uri: await secretProvider.getAppSecret('GOOGLE_REDIRECT_URI') || 'https://api.algapsa.com/api/auth/google/callback'
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
 * Assert user is authenticated and return user
 */
async function assertAuthenticated() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }
  return user;
}

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
  
  if (effectiveClientId && typeof effectiveClientId === 'string' && !hostedConfig) {
    // Only store user-provided secrets, not hosted ones
    await secretProvider.setTenantSecret(tenant, 'microsoft_client_id', effectiveClientId);
  }
  if (effectiveClientSecret && typeof effectiveClientSecret === 'string' && !hostedConfig) {
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
      updated_at = CURRENT_TIMESTAMP
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

  // Check if we should use hosted configuration for Enterprise Edition
  const hostedConfig = await getHostedGmailConfig();

  // Save secrets to tenant-specific secret store
  const secretProvider = await getSecretProviderInstance();
  
  // Use hosted credentials if available, otherwise use user-provided credentials
  const effectiveClientId = hostedConfig?.client_id || config.client_id;
  const effectiveClientSecret = hostedConfig?.client_secret || config.client_secret;
  const effectiveProjectId = hostedConfig?.project_id || config.project_id;
  const effectiveRedirectUri = hostedConfig?.redirect_uri || config.redirect_uri;
  
  // Ensure required fields are not undefined
  if (!effectiveProjectId) {
    throw new Error('Project ID is required for Gmail configuration');
  }
  if (!effectiveRedirectUri) {
    throw new Error('Redirect URI is required for Gmail configuration');
  }
  
  if (effectiveClientId && typeof effectiveClientId === 'string' && !hostedConfig) {
    // Only store user-provided secrets, not hosted ones
    await secretProvider.setTenantSecret(tenant, 'google_client_id', effectiveClientId);
  }
  if (effectiveClientSecret && typeof effectiveClientSecret === 'string' && !hostedConfig) {
    // Only store user-provided secrets, not hosted ones
    await secretProvider.setTenantSecret(tenant, 'google_client_secret', effectiveClientSecret);
  }
  
  // Generate standardized Pub/Sub names
  const pubsubNames = await generatePubSubNames(tenant);
  
  // Prepare config payload
  const labelFiltersArray = config.label_filters || [];
  const configPayload = {
    email_provider_id: providerId,
    tenant,
    client_id: effectiveClientId || null,
    client_secret: effectiveClientSecret || null,
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
      updated_at = CURRENT_TIMESTAMP
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
 * Finalize Google provider setup with Pub/Sub and Gmail watch
 */

export async function getEmailProviders(): Promise<{ providers: EmailProvider[] }> {
  await assertAuthenticated();
  const { knex, tenant } = await createTenantKnex();
  
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
      }
      
      return provider;
    }));

    return { providers: providersWithConfig };
  } catch (error) {
    console.error('Failed to load email providers:', error);
    // Return empty array if table doesn't exist yet
    return { providers: [] };
  }
}

export async function upsertEmailProvider(data: {
  tenant: string;
  providerType: string;
  providerName: string;
  mailbox: string;
  isActive: boolean;
  inboundTicketDefaultsId?: string;
  microsoftConfig?: Omit<MicrosoftEmailProviderConfig, 'email_provider_id' | 'tenant' | 'created_at' | 'updated_at'>;
  googleConfig?: Omit<GoogleEmailProviderConfig, 'email_provider_id' | 'tenant' | 'created_at' | 'updated_at'>;
}, skipAutomation?: boolean): Promise<{ provider: EmailProvider }> {
  await assertAuthenticated();
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) throw new Error('Tenant is required');
  
  try {
    const provider = await knex.transaction(async (trx) => {
      const base = await getOrCreateProvider(trx, tenant, data);
      
      if (data.providerType === 'microsoft') {
        base.microsoftConfig = await persistMicrosoftConfig(trx, tenant, base.id, data.microsoftConfig);
      } else if (data.providerType === 'google') {
        base.googleConfig = await persistGoogleConfig(trx, tenant, base.id, data.googleConfig);
      }
      
      return base;
    });
    
    if (!skipAutomation && data.providerType === 'google' && provider.googleConfig) {
      // Use hosted project ID if in EE mode, otherwise use provided project ID
      const hostedConfig = await getHostedGmailConfig();
      const effectiveProjectId = hostedConfig?.project_id || data.googleConfig?.project_id;
      
      if (effectiveProjectId) {
        await configureGmailProvider({
          tenant,
          providerId: provider.id,
          projectId: effectiveProjectId
        });
        // Update returned provider state to reflect side-effects
        provider.lastSyncAt = new Date().toISOString();
        provider.status = 'connected';
      }
    }
    
    if (!skipAutomation && data.providerType === 'microsoft' && provider.microsoftConfig) {
      try {
        const service = new EmailProviderService();
        await service.initializeProviderWebhook(provider.id);
        // Update returned provider state to reflect side-effects
        provider.lastSyncAt = new Date().toISOString();
        provider.status = 'connected';
      } catch (error) {
        console.error('Failed to initialize Microsoft webhook:', error);
        // Don't throw here - provider is saved, but webhook failed
      }
    }
    
    return { provider };
  } catch (error) {
    console.error('Failed to upsert email provider:', error);
    throw new Error('Failed to upsert email provider');
  }
}

export async function createEmailProvider(data: {
  tenant: string;
  providerType: string;
  providerName: string;
  mailbox: string;
  isActive: boolean;
  inboundTicketDefaultsId?: string;
  microsoftConfig?: Omit<MicrosoftEmailProviderConfig, 'email_provider_id' | 'tenant' | 'created_at' | 'updated_at'>;
  googleConfig?: Omit<GoogleEmailProviderConfig, 'email_provider_id' | 'tenant' | 'created_at' | 'updated_at'>;
}, skipAutomation?: boolean): Promise<{ provider: EmailProvider }> {
  // Delegate to upsertEmailProvider since they have identical logic
  return upsertEmailProvider(data, skipAutomation);
}

export async function updateEmailProvider(
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
  },
  skipAutomation?: boolean
): Promise<{ provider: EmailProvider }> {
  await assertAuthenticated();
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) throw new Error('Tenant is required');
  
  try {
    const provider = await knex.transaction(async (trx) => {
      const base = await getOrCreateProvider(trx, tenant, data, providerId);
      
      if (data.providerType === 'microsoft') {
        base.microsoftConfig = await persistMicrosoftConfig(trx, tenant, base.id, data.microsoftConfig);
      } else if (data.providerType === 'google') {
        base.googleConfig = await persistGoogleConfig(trx, tenant, base.id, data.googleConfig);
      }
      
      return base;
    });
    
    if (!skipAutomation && data.providerType === 'google' && provider.googleConfig) {
      // Use hosted project ID if in EE mode, otherwise use provided project ID
      const hostedConfig = await getHostedGmailConfig();
      const effectiveProjectId = hostedConfig?.project_id || data.googleConfig?.project_id;
      
      if (effectiveProjectId) {
        await configureGmailProvider({
          tenant,
          providerId: provider.id,
          projectId: effectiveProjectId
        });
        // Update returned provider state to reflect side-effects
        provider.lastSyncAt = new Date().toISOString();
        provider.status = 'connected';
      }
    }
    
    if (!skipAutomation && data.providerType === 'microsoft' && provider.microsoftConfig) {
      try {
        const service = new EmailProviderService();
        await service.initializeProviderWebhook(provider.id);
        // Update returned provider state to reflect side-effects
        provider.lastSyncAt = new Date().toISOString();
        provider.status = 'connected';
      } catch (error) {
        console.error('Failed to initialize Microsoft webhook:', error);
        // Don't throw here - provider is saved, but webhook failed
      }
    }
    
    return { provider };
  } catch (error) {
    console.error('Failed to update email provider:', error);
    throw new Error('Failed to update email provider');
  }
}

export async function deleteEmailProvider(providerId: string): Promise<void> {
  await assertAuthenticated();
  const { knex, tenant } = await createTenantKnex();
  
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
}

export async function testEmailProviderConnection(providerId: string): Promise<{ success: boolean; error?: string }> {
  await assertAuthenticated();
  const { knex, tenant } = await createTenantKnex();
  
  try {
    const provider = await knex('email_providers')
      .where({ id: providerId, tenant })
      .first();

    if (!provider) {
      throw new Error('Provider not found');
    }

    // TODO: Implement actual connection testing logic based on provider type
    // For now, we'll simulate a successful test
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
}

/**
 * Manually retry Microsoft subscription renewal for a specific provider
 */
export async function retryMicrosoftSubscriptionRenewal(providerId: string): Promise<{ success: boolean; message?: string }> {
  try {
    const user = await assertAuthenticated();
    
    const service = new EmailWebhookMaintenanceService();
    const results = await service.renewMicrosoftWebhooks({
      tenantId: user.tenant,
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
}

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
