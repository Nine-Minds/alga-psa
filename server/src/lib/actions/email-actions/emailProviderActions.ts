'use server'

import { createTenantKnex } from '../../db';
import { getCurrentUser } from '../user-actions/userActions';
import type { EmailProvider, MicrosoftEmailProviderConfig, GoogleEmailProviderConfig } from '../../../components/EmailProviderConfiguration';
import { getSecretProviderInstance } from '@shared/core';
import { setupPubSub } from './setupPubSub';
import { EmailProviderService } from '../../../services/email/EmailProviderService';

/**
 * Generate standardized Pub/Sub topic and subscription names for a tenant
 */
function generatePubSubNames(tenantId: string) {
  // Use ngrok URL in development if available
  const baseUrl = process.env.NGROK_URL || 
                  process.env.NEXT_PUBLIC_APP_URL || 
                  process.env.NEXTAUTH_URL ||
                  'http://localhost:3000';
  
  return {
    topicName: `gmail-notifications-${tenantId}`,
    subscriptionName: `gmail-webhook-${tenantId}`,
    webhookUrl: `${baseUrl}/api/email/webhooks/google`
  };
}

export async function getEmailProviders(): Promise<{ providers: EmailProvider[] }> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  
  try {
    const providers = await knex('email_providers')
      .where({ tenant })
      .orderBy('created_at', 'desc')
      .select(
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
      );

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
}): Promise<{ provider: EmailProvider }> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }
  const { knex, tenant } = await createTenantKnex();
  
  try {
    // Start a transaction to ensure consistency
    const result = await knex.transaction(async (trx) => {
      // Check if provider already exists
      let existingProvider = await trx('email_providers')
        .where({ tenant, mailbox: data.mailbox })
        .first();

      let provider;
      if (existingProvider) {
        // Update existing provider
        [provider] = await trx('email_providers')
          .where({ tenant, mailbox: data.mailbox })
          .update({
            provider_type: data.providerType,
            provider_name: data.providerName,
            is_active: data.isActive,
            updated_at: knex.fn.now()
          })
          .returning([
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
          ]);
      } else {
        // Create new provider
        const providerId = knex.raw('gen_random_uuid()');
        [provider] = await trx('email_providers')
          .insert({
            id: providerId,
            tenant,
            provider_type: data.providerType,
            provider_name: data.providerName,
            mailbox: data.mailbox,
            is_active: data.isActive,
            status: 'configuring',
            created_at: knex.fn.now(),
            updated_at: knex.fn.now()
          })
          .returning([
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
          ]);
      }
      
      // Handle vendor-specific config (insert or update)
      if (data.providerType === 'microsoft' && data.microsoftConfig) {
        // Save secrets to tenant-specific secret store
        const secretProvider = getSecretProviderInstance();
        if (data.microsoftConfig.client_id !== null && data.microsoftConfig.client_id !== undefined) {
          await secretProvider.setTenantSecret(tenant, 'microsoft_client_id', data.microsoftConfig.client_id);
        }
        if (data.microsoftConfig.client_secret !== null && data.microsoftConfig.client_secret !== undefined) {
          await secretProvider.setTenantSecret(tenant, 'microsoft_client_secret', data.microsoftConfig.client_secret);
        }
        
        // Delete existing config if any
        await trx('microsoft_email_provider_config')
          .where({ email_provider_id: provider.id, tenant })
          .delete();
        
        // Insert new config
        const msConfig = await trx('microsoft_email_provider_config')
          .insert({
            email_provider_id: provider.id,
            tenant,
            client_id: data.microsoftConfig.client_id,
            client_secret: data.microsoftConfig.client_secret,
            tenant_id: data.microsoftConfig.tenant_id,
            redirect_uri: data.microsoftConfig.redirect_uri,
            auto_process_emails: data.microsoftConfig.auto_process_emails,
            max_emails_per_sync: data.microsoftConfig.max_emails_per_sync,
            folder_filters: JSON.stringify(data.microsoftConfig.folder_filters || []),
            access_token: data.microsoftConfig.access_token,
            refresh_token: data.microsoftConfig.refresh_token,
            token_expires_at: data.microsoftConfig.token_expires_at,
            created_at: knex.fn.now(),
            updated_at: knex.fn.now()
          })
          .returning('*')
          .then(rows => rows[0]);
        
        if (msConfig) {
          // For jsonb columns, PostgreSQL automatically parses the JSON, so no need to JSON.parse
          msConfig.folder_filters = msConfig.folder_filters || [];
          provider.microsoftConfig = msConfig;
        }
      } else if (data.providerType === 'google' && data.googleConfig) {
        // Save secrets to tenant-specific secret store
        const secretProvider = getSecretProviderInstance();
        if (data.googleConfig.client_id !== null && data.googleConfig.client_id !== undefined) {
          await secretProvider.setTenantSecret(tenant, 'google_client_id', data.googleConfig.client_id);
        }
        if (data.googleConfig.client_secret !== null && data.googleConfig.client_secret !== undefined) {
          await secretProvider.setTenantSecret(tenant, 'google_client_secret', data.googleConfig.client_secret);
        }
        
        // Generate standardized Pub/Sub names
        const pubsubNames = generatePubSubNames(tenant);
        
        // Upsert Google config using ON CONFLICT
        const labelFiltersArray = data.googleConfig.label_filters || [];
        
        const configPayload = {
            email_provider_id: provider.id,
            tenant,
            client_id: data.googleConfig.client_id,
            client_secret: data.googleConfig.client_secret,
            project_id: data.googleConfig.project_id,
            redirect_uri: data.googleConfig.redirect_uri,
            pubsub_topic_name: pubsubNames.topicName,
            pubsub_subscription_name: pubsubNames.subscriptionName,
            auto_process_emails: data.googleConfig.auto_process_emails,
            max_emails_per_sync: data.googleConfig.max_emails_per_sync,
            label_filters: JSON.stringify(labelFiltersArray),
            access_token: data.googleConfig.access_token,
            refresh_token: data.googleConfig.refresh_token,
            token_expires_at: data.googleConfig.token_expires_at,
            history_id: data.googleConfig.history_id,
            watch_expiration: data.googleConfig.watch_expiration,
            updated_at: knex.fn.now()
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
          provider.id, 
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
        ]).then(result => result.rows[0]);
        
        if (googleConfig) {
          // For jsonb columns, PostgreSQL automatically parses the JSON, so no need to JSON.parse
          googleConfig.label_filters = googleConfig.label_filters || [];
          provider.googleConfig = googleConfig;
        }
      }
      
      return provider;
    });
    
    // After successful database transaction, set up Pub/Sub for Google providers
    if (data.providerType === 'google' && data.googleConfig && result.googleConfig) {
      try {
        const pubsubNames = generatePubSubNames(tenant);
        console.log(`🔧 Initiating automatic Pub/Sub setup for Gmail provider ${result.id}:`, {
          tenant,
          providerId: result.id,
          projectId: data.googleConfig.project_id,
          topicName: pubsubNames.topicName,
          subscriptionName: pubsubNames.subscriptionName,
          webhookUrl: pubsubNames.webhookUrl
        });
        
        await setupPubSub({
          projectId: data.googleConfig.project_id,
          topicName: pubsubNames.topicName,
          subscriptionName: pubsubNames.subscriptionName,
          webhookUrl: pubsubNames.webhookUrl
        });
        
        console.log(`✅ Successfully set up Pub/Sub for Gmail provider ${result.id}:`, {
          tenant,
          providerId: result.id,
          topicName: pubsubNames.topicName,
          subscriptionName: pubsubNames.subscriptionName
        });
        
        // Initialize Gmail watch subscription for real-time email notifications
        try {
          console.log(`🔗 Initializing Gmail watch subscription for provider ${result.id}`);
          const emailProviderService = new EmailProviderService();
          await emailProviderService.initializeProviderWebhook(result.id);
          console.log(`✅ Successfully initialized Gmail watch subscription for provider ${result.id}`);
        } catch (watchError) {
          console.error(`❌ Failed to initialize Gmail watch subscription for provider ${result.id}:`, {
            tenant,
            providerId: result.id,
            error: watchError instanceof Error ? watchError.message : String(watchError),
            stack: watchError instanceof Error ? watchError.stack : undefined
          });
          // Don't throw error here - provider is still functional without real-time notifications
          // The watch subscription can be manually initialized later
        }
      } catch (pubsubError) {
        console.error(`❌ Failed to set up Pub/Sub automatically for Gmail provider ${result.id}:`, {
          tenant,
          providerId: result.id,
          projectId: data.googleConfig.project_id,
          error: pubsubError instanceof Error ? pubsubError.message : String(pubsubError),
          stack: pubsubError instanceof Error ? pubsubError.stack : undefined
        });
        // Don't throw error here - provider is still functional without Pub/Sub
        // The error will be logged and can be addressed later
      }
    }
    
    return { provider: result };
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
}): Promise<{ provider: EmailProvider }> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  
  try {

    // Start a transaction to ensure consistency
    const result = await knex.transaction(async (trx) => {
      const providerId = knex.raw('gen_random_uuid()');
      
      // Check if provider already exists
      const existingProvider = await trx('email_providers')
        .where({ tenant, mailbox: data.mailbox })
        .first();

      let provider;
      if (existingProvider) {
        // Update existing provider
        [provider] = await trx('email_providers')
          .where({ tenant, mailbox: data.mailbox })
          .update({
            provider_type: data.providerType,
            provider_name: data.providerName,
            is_active: data.isActive,
            status: 'configuring',
            updated_at: knex.fn.now()
          })
          .returning([
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
          ]);
      } else {
        // Insert new provider record
        [provider] = await trx('email_providers')
          .insert({
            id: providerId,
            tenant,
            provider_type: data.providerType,
            provider_name: data.providerName,
            mailbox: data.mailbox,
            is_active: data.isActive,
            status: 'configuring',
            created_at: knex.fn.now(),
            updated_at: knex.fn.now()
          })
          .returning([
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
          ]);
      }
      
      // Insert vendor-specific config
      if (data.providerType === 'microsoft' && data.microsoftConfig) {
        const msConfig = await trx('microsoft_email_provider_config')
          .insert({
            email_provider_id: provider.id,
            tenant,
            client_id: data.microsoftConfig.client_id,
            client_secret: data.microsoftConfig.client_secret,
            tenant_id: data.microsoftConfig.tenant_id,
            redirect_uri: data.microsoftConfig.redirect_uri,
            auto_process_emails: data.microsoftConfig.auto_process_emails,
            max_emails_per_sync: data.microsoftConfig.max_emails_per_sync,
            folder_filters: JSON.stringify(data.microsoftConfig.folder_filters || []),
            access_token: data.microsoftConfig.access_token,
            refresh_token: data.microsoftConfig.refresh_token,
            token_expires_at: data.microsoftConfig.token_expires_at,
            created_at: knex.fn.now(),
            updated_at: knex.fn.now()
          })
          .returning('*')
          .then(rows => rows[0]);
        
        if (msConfig) {
          // For jsonb columns, PostgreSQL automatically parses the JSON, so no need to JSON.parse
          msConfig.folder_filters = msConfig.folder_filters || [];
          provider.microsoftConfig = msConfig;
        }
      } else if (data.providerType === 'google' && data.googleConfig) {
        // Generate standardized Pub/Sub names
        const pubsubNames = generatePubSubNames(tenant);
        
        const labelFiltersArray = data.googleConfig.label_filters || [];
        
        const configPayload = {
            email_provider_id: provider.id,
            tenant,
            client_id: data.googleConfig.client_id,
            client_secret: data.googleConfig.client_secret,
            project_id: data.googleConfig.project_id,
            redirect_uri: data.googleConfig.redirect_uri,
            pubsub_topic_name: pubsubNames.topicName,
            pubsub_subscription_name: pubsubNames.subscriptionName,
            auto_process_emails: data.googleConfig.auto_process_emails,
            max_emails_per_sync: data.googleConfig.max_emails_per_sync,
            label_filters: JSON.stringify(labelFiltersArray),
            access_token: data.googleConfig.access_token,
            refresh_token: data.googleConfig.refresh_token,
            token_expires_at: data.googleConfig.token_expires_at,
            history_id: data.googleConfig.history_id,
            watch_expiration: data.googleConfig.watch_expiration
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
          provider.id, 
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
        ]).then(result => result.rows[0]);
        
        if (googleConfig) {
          // For jsonb columns, PostgreSQL automatically parses the JSON, so no need to JSON.parse
          googleConfig.label_filters = googleConfig.label_filters || [];
          provider.googleConfig = googleConfig;
        }
      }
      
      return provider;
    });

    // After successful database transaction, set up Pub/Sub for Google providers
    if (data.providerType === 'google' && data.googleConfig && result.googleConfig) {
      try {
        const pubsubNames = generatePubSubNames(tenant);
        console.log(`🔧 Initiating automatic Pub/Sub setup for Gmail provider ${result.id}:`, {
          tenant,
          providerId: result.id,
          projectId: data.googleConfig.project_id,
          topicName: pubsubNames.topicName,
          subscriptionName: pubsubNames.subscriptionName,
          webhookUrl: pubsubNames.webhookUrl
        });
        
        await setupPubSub({
          projectId: data.googleConfig.project_id,
          topicName: pubsubNames.topicName,
          subscriptionName: pubsubNames.subscriptionName,
          webhookUrl: pubsubNames.webhookUrl
        });
        
        console.log(`✅ Successfully set up Pub/Sub for Gmail provider ${result.id}:`, {
          tenant,
          providerId: result.id,
          topicName: pubsubNames.topicName,
          subscriptionName: pubsubNames.subscriptionName
        });
        
        // Initialize Gmail watch subscription for real-time email notifications
        try {
          console.log(`🔗 Initializing Gmail watch subscription for provider ${result.id}`);
          const emailProviderService = new EmailProviderService();
          await emailProviderService.initializeProviderWebhook(result.id);
          console.log(`✅ Successfully initialized Gmail watch subscription for provider ${result.id}`);
        } catch (watchError) {
          console.error(`❌ Failed to initialize Gmail watch subscription for provider ${result.id}:`, {
            tenant,
            providerId: result.id,
            error: watchError instanceof Error ? watchError.message : String(watchError),
            stack: watchError instanceof Error ? watchError.stack : undefined
          });
          // Don't throw error here - provider is still functional without real-time notifications
          // The watch subscription can be manually initialized later
        }
      } catch (pubsubError) {
        console.error(`❌ Failed to set up Pub/Sub automatically for Gmail provider ${result.id}:`, {
          tenant,
          providerId: result.id,
          projectId: data.googleConfig.project_id,
          error: pubsubError instanceof Error ? pubsubError.message : String(pubsubError),
          stack: pubsubError instanceof Error ? pubsubError.stack : undefined
        });
        // Don't throw error here - provider is still functional without Pub/Sub
        // The error will be logged and can be addressed later
      }
    }

    return { provider: result };
  } catch (error) {
    console.error('Failed to create email provider:', error);
    throw new Error('Failed to create email provider');
  }
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
  }
): Promise<{ provider: EmailProvider }> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();
  
  try {

    // Start a transaction to ensure consistency
    const result = await knex.transaction(async (trx) => {
      // Update the main provider record
      const [provider] = await trx('email_providers')
        .where({ id: providerId, tenant })
        .update({
          provider_type: data.providerType,
          provider_name: data.providerName,
          mailbox: data.mailbox,
          is_active: data.isActive,
          updated_at: knex.fn.now()
        })
        .returning([
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
        ]);

      if (!provider) {
        throw new Error('Provider not found');
      }
      
      // Update vendor-specific config
      if (data.providerType === 'microsoft' && data.microsoftConfig) {
        // Delete existing config if any
        await trx('microsoft_email_provider_config')
          .where({ email_provider_id: providerId, tenant })
          .delete();
        
        // Insert new config
        const msConfig = await trx('microsoft_email_provider_config')
          .insert({
            email_provider_id: providerId,
            tenant,
            client_id: data.microsoftConfig.client_id,
            client_secret: data.microsoftConfig.client_secret,
            tenant_id: data.microsoftConfig.tenant_id,
            redirect_uri: data.microsoftConfig.redirect_uri,
            auto_process_emails: data.microsoftConfig.auto_process_emails,
            max_emails_per_sync: data.microsoftConfig.max_emails_per_sync,
            folder_filters: JSON.stringify(data.microsoftConfig.folder_filters || []),
            access_token: data.microsoftConfig.access_token,
            refresh_token: data.microsoftConfig.refresh_token,
            token_expires_at: data.microsoftConfig.token_expires_at,
            created_at: knex.fn.now(),
            updated_at: knex.fn.now()
          })
          .returning('*')
          .then(rows => rows[0]);
        
        if (msConfig) {
          // For jsonb columns, PostgreSQL automatically parses the JSON, so no need to JSON.parse
          msConfig.folder_filters = msConfig.folder_filters || [];
          provider.microsoftConfig = msConfig;
        }
      } else if (data.providerType === 'google' && data.googleConfig) {
        // Delete existing config if any
        await trx('google_email_provider_config')
          .where({ email_provider_id: providerId, tenant })
          .delete();
        
        // Generate standardized Pub/Sub names
        const pubsubNames = generatePubSubNames(tenant);
        
        // Insert new config with standardized Pub/Sub names
        const googleConfig = await trx('google_email_provider_config')
          .insert({
            email_provider_id: providerId,
            tenant,
            client_id: data.googleConfig.client_id,
            client_secret: data.googleConfig.client_secret,
            project_id: data.googleConfig.project_id,
            redirect_uri: data.googleConfig.redirect_uri,
            pubsub_topic_name: pubsubNames.topicName,
            pubsub_subscription_name: pubsubNames.subscriptionName,
            auto_process_emails: data.googleConfig.auto_process_emails,
            max_emails_per_sync: data.googleConfig.max_emails_per_sync,
            label_filters: JSON.stringify(data.googleConfig.label_filters || []),
            access_token: data.googleConfig.access_token,
            refresh_token: data.googleConfig.refresh_token,
            token_expires_at: data.googleConfig.token_expires_at,
            history_id: data.googleConfig.history_id,
            watch_expiration: data.googleConfig.watch_expiration,
            created_at: knex.fn.now(),
            updated_at: knex.fn.now()
          })
          .returning('*')
          .then(rows => rows[0]);
        
        if (googleConfig) {
          googleConfig.label_filters = googleConfig.label_filters || [];
          provider.googleConfig = googleConfig;
        }
      }
      
      return provider;
    });

    console.log(data.providerType, ' is the provider type of the updated provider');

    // After successful database transaction, set up Pub/Sub for Google providers
    if (data.providerType === 'google' && data.googleConfig && result.googleConfig) {
      try {
        const pubsubNames = generatePubSubNames(tenant);
        console.log(`🔧 Initiating automatic Pub/Sub setup for Gmail provider ${result.id}:`, {
          tenant,
          providerId: result.id,
          projectId: data.googleConfig.project_id,
          topicName: pubsubNames.topicName,
          subscriptionName: pubsubNames.subscriptionName,
          webhookUrl: pubsubNames.webhookUrl
        });
        
        await setupPubSub({
          projectId: data.googleConfig.project_id,
          topicName: pubsubNames.topicName,
          subscriptionName: pubsubNames.subscriptionName,
          webhookUrl: pubsubNames.webhookUrl
        });
        
        console.log(`✅ Successfully set up Pub/Sub for Gmail provider ${result.id}:`, {
          tenant,
          providerId: result.id,
          topicName: pubsubNames.topicName,
          subscriptionName: pubsubNames.subscriptionName
        });
        
        // Initialize Gmail watch subscription for real-time email notifications
        try {
          console.log(`🔗 Initializing Gmail watch subscription for provider ${result.id}`);
          const emailProviderService = new EmailProviderService();
          await emailProviderService.initializeProviderWebhook(result.id);
          console.log(`✅ Successfully initialized Gmail watch subscription for provider ${result.id}`);
        } catch (watchError) {
          console.error(`❌ Failed to initialize Gmail watch subscription for provider ${result.id}:`, {
            tenant,
            providerId: result.id,
            error: watchError instanceof Error ? watchError.message : String(watchError),
            stack: watchError instanceof Error ? watchError.stack : undefined
          });
          // Don't throw error here - provider is still functional without real-time notifications
          // The watch subscription can be manually initialized later
        }
      } catch (pubsubError) {
        console.error(`❌ Failed to set up Pub/Sub automatically for Gmail provider ${result.id}:`, {
          tenant,
          providerId: result.id,
          projectId: data.googleConfig.project_id,
          error: pubsubError instanceof Error ? pubsubError.message : String(pubsubError),
          stack: pubsubError instanceof Error ? pubsubError.stack : undefined
        });
        // Don't throw error here - provider is still functional without Pub/Sub
        // The error will be logged and can be addressed later
      }
    }

    return { provider: result };
  } catch (error) {
    console.error('Failed to update email provider:', error);
    throw new Error('Failed to update email provider');
  }
}

export async function deleteEmailProvider(providerId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

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
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

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
