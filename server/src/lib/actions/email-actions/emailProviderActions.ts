'use server'

import { createTenantKnex } from '../../db';
import { getCurrentUser } from '../user-actions/userActions';
import type { EmailProvider, MicrosoftEmailProviderConfig, GoogleEmailProviderConfig } from '../../../components/EmailProviderConfiguration';


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
          msConfig.folder_filters = JSON.parse(msConfig.folder_filters || '[]');
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
          googleConfig.label_filters = JSON.parse(googleConfig.label_filters || '[]');
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
      
      // Insert the main provider record
      const [provider] = await trx('email_providers')
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
          msConfig.folder_filters = JSON.parse(msConfig.folder_filters || '[]');
          provider.microsoftConfig = msConfig;
        }
      } else if (data.providerType === 'google' && data.googleConfig) {
        const googleConfig = await trx('google_email_provider_config')
          .insert({
            email_provider_id: provider.id,
            tenant,
            client_id: data.googleConfig.client_id,
            client_secret: data.googleConfig.client_secret,
            project_id: data.googleConfig.project_id,
            redirect_uri: data.googleConfig.redirect_uri,
            pubsub_topic_name: data.googleConfig.pubsub_topic_name,
            pubsub_subscription_name: data.googleConfig.pubsub_subscription_name,
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
          googleConfig.label_filters = JSON.parse(googleConfig.label_filters || '[]');
          provider.googleConfig = googleConfig;
        }
      }
      
      return provider;
    });

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
          msConfig.folder_filters = JSON.parse(msConfig.folder_filters || '[]');
          provider.microsoftConfig = msConfig;
        }
      } else if (data.providerType === 'google' && data.googleConfig) {
        // Delete existing config if any
        await trx('google_email_provider_config')
          .where({ email_provider_id: providerId, tenant })
          .delete();
        
        // Insert new config
        const googleConfig = await trx('google_email_provider_config')
          .insert({
            email_provider_id: providerId,
            tenant,
            client_id: data.googleConfig.client_id,
            client_secret: data.googleConfig.client_secret,
            project_id: data.googleConfig.project_id,
            redirect_uri: data.googleConfig.redirect_uri,
            pubsub_topic_name: data.googleConfig.pubsub_topic_name,
            pubsub_subscription_name: data.googleConfig.pubsub_subscription_name,
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
          googleConfig.label_filters = JSON.parse(googleConfig.label_filters || '[]');
          provider.googleConfig = googleConfig;
        }
      }
      
      return provider;
    });

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
