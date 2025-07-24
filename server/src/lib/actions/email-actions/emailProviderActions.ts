'use server'

import { createTenantKnex } from '../../db';
import { getCurrentUser } from '../user-actions/userActions';
import type { EmailProvider, MicrosoftEmailProviderConfig, GoogleEmailProviderConfig } from '../../../components/EmailProviderConfiguration';
import { getSecretProviderInstance } from '@shared/core';
import { setupPubSub } from './setupPubSub';
import { EmailProviderService } from '../../../services/email/EmailProviderService';
import { configureGmailProvider } from './configureGmailProvider';

/**
 * Generate standardized Pub/Sub topic and subscription names for a tenant
 */
async function generatePubSubNames(tenantId: string) {
  // Use ngrok URL in development if available
  const secretProvider = await getSecretProviderInstance();
  const baseUrl = await secretProvider.getAppSecret('NGROK_URL') || 
                  await secretProvider.getAppSecret('NEXT_PUBLIC_APP_URL') || 
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
  const isEnterprise = process.env.NEXT_PUBLIC_EDITION === 'enterprise';
  
  if (!isEnterprise) {
    console.log('Skipping hosted Gmail config for non-enterprise edition');
    return null;
  }
  
  const secretProvider = await getSecretProviderInstance();
  
  return {
    client_id: await secretProvider.getAppSecret('EE_GMAIL_CLIENT_ID'),
    client_secret: await secretProvider.getAppSecret('EE_GMAIL_CLIENT_SECRET'),
    project_id: await secretProvider.getAppSecret('EE_GMAIL_PROJECT_ID'),
    redirect_uri: await secretProvider.getAppSecret('EE_GMAIL_REDIRECT_URI') || 'https://api.algapsa.com/api/auth/google/callback'
  };
}

/**
 * Get hosted Microsoft configuration for Enterprise Edition
 */
export async function getHostedMicrosoftConfig() {
  const isEnterprise = process.env.NEXT_PUBLIC_EDITION === 'enterprise';
  
  if (!isEnterprise) {
    return null;
  }
  
  const secretProvider = await getSecretProviderInstance();
  
  return {
    client_id: await secretProvider.getAppSecret('EE_MICROSOFT_CLIENT_ID'),
    client_secret: await secretProvider.getAppSecret('EE_MICROSOFT_CLIENT_SECRET'),
    tenant_id: await secretProvider.getAppSecret('EE_MICROSOFT_TENANT_ID') || 'common',
    redirect_uri: await secretProvider.getAppSecret('EE_MICROSOFT_REDIRECT_URI') || 'https://api.algapsa.com/api/auth/microsoft/callback'
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
  
  // Delete existing config if any
  await trx('microsoft_email_provider_config')
    .where({ email_provider_id: providerId, tenant })
    .delete();
  
  // Insert new config
  const msConfig = await trx('microsoft_email_provider_config')
    .insert({
      email_provider_id: providerId,
      tenant,
      client_id: effectiveClientId || null,
      client_secret: effectiveClientSecret || null,
      tenant_id: effectiveTenantId,
      redirect_uri: effectiveRedirectUri,
      auto_process_emails: config.auto_process_emails,
      max_emails_per_sync: config.max_emails_per_sync,
      folder_filters: JSON.stringify(config.folder_filters || []),
      access_token: config.access_token,
      refresh_token: config.refresh_token,
      token_expires_at: config.token_expires_at,
      created_at: trx.fn.now(),
      updated_at: trx.fn.now()
    })
    .returning('*')
    .then((rows: any[]) => rows[0]);
  
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
      access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      token_expires_at = EXCLUDED.token_expires_at,
      history_id = EXCLUDED.history_id,
      watch_expiration = EXCLUDED.watch_expiration,
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

// Re-export setupPubSub from the actual implementation
// export { setupPubSub } from './setupPubSub';
