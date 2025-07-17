/**
 * Email Provider Service
 * Handles CRUD operations for email provider configurations
 */

import { createTenantKnex } from '../../lib/db';
import { EmailProviderConfig } from '../../interfaces/email.interfaces';
import { MicrosoftGraphAdapter } from './providers/MicrosoftGraphAdapter';
import { GmailAdapter } from './providers/GmailAdapter';
import { GmailWebhookService } from './GmailWebhookService';

export interface CreateProviderData {
  tenant: string;
  providerType: 'microsoft' | 'google';
  providerName: string;
  mailbox: string;
  isActive: boolean;
  vendorConfig: any;
}

export interface UpdateProviderData {
  providerName?: string;
  mailbox?: string;
  isActive?: boolean;
  vendorConfig?: any;
}

export interface GetProvidersFilter {
  tenant: string;
  providerType?: 'microsoft' | 'google';
  isActive?: boolean;
  mailbox?: string;
}

export interface ProviderStatus {
  status: 'connected' | 'disconnected' | 'error' | 'configuring';
  errorMessage?: string | null;
  lastSyncAt?: string;
}

export class EmailProviderService {
  private async getDb() {
    const { knex } = await createTenantKnex();
    return knex;
  }

  /**
   * Generate webhook URL with proper environment-aware base URL
   * Uses the same priority logic as generatePubSubNames
   */
  private generateWebhookUrl(path: string): string {
    const baseUrl = process.env.NGROK_URL || 
                    process.env.NEXT_PUBLIC_APP_URL || 
                    process.env.NEXTAUTH_URL ||
                    'http://localhost:3000';
    return `${baseUrl}${path}`;
  }

  /**
   * Get email providers based on filters
   */
  async getProviders(filters: GetProvidersFilter): Promise<EmailProviderConfig[]> {
    try {
      const db = await this.getDb();
      let query = db('email_providers')
        .where('tenant', filters.tenant)
        .orderBy('created_at', 'desc');

      if (filters.providerType) {
        query = query.where('provider_type', filters.providerType);
      }

      if (filters.isActive !== undefined) {
        query = query.where('is_active', filters.isActive);
      }

      if (filters.mailbox) {
        query = query.where('mailbox', filters.mailbox);
      }

      const providers = await query;
      
      // Load vendor configs for each provider
      const providersWithConfig = await Promise.all(providers.map(async (provider) => {
        let vendorConfig = null;
        if (provider.provider_type === 'google') {
          vendorConfig = await db('google_email_provider_config')
            .where('email_provider_id', provider.id)
            .first();
        } else if (provider.provider_type === 'microsoft') {
          vendorConfig = await db('microsoft_email_provider_config')
            .where('email_provider_id', provider.id)
            .first();
        }
        return this.mapCurrentDbRowToProvider(provider, vendorConfig);
      }));

      return providersWithConfig;
    } catch (error: any) {
      console.error('Error fetching email providers:', error);
      throw new Error(`Failed to fetch email providers: ${error.message}`);
    }
  }

  /**
   * Get a single email provider by ID
   */
  async getProvider(providerId: string): Promise<EmailProviderConfig | null> {
    try {
      const db = await this.getDb();
      const provider = await db('email_providers')
        .where('id', providerId)
        .first();

      if (!provider) {
        return null;
      }

      // Load vendor-specific configuration
      let vendorConfig = null;
      if (provider.provider_type === 'google') {
        vendorConfig = await db('google_email_provider_config')
          .where('email_provider_id', providerId)
          .first();
      } else if (provider.provider_type === 'microsoft') {
        vendorConfig = await db('microsoft_email_provider_config')
          .where('email_provider_id', providerId)
          .first();
      }

      return this.mapCurrentDbRowToProvider(provider, vendorConfig);
    } catch (error: any) {
      console.error(`Error fetching email provider ${providerId}:`, error);
      throw new Error(`Failed to fetch email provider: ${error.message}`);
    }
  }

  /**
   * Create a new email provider
   */
  async createProvider(data: CreateProviderData): Promise<EmailProviderConfig> {
    try {
      const db = await this.getDb();
      const [provider] = await db('email_provider_configs')
        .insert({
          id: db.raw('gen_random_uuid()'),
          tenant: data.tenant,
          provider_type: data.providerType,
          name: data.providerName,
          mailbox: data.mailbox,
          folder_to_monitor: 'Inbox',
          active: data.isActive,
          connection_status: 'disconnected',
          webhook_notification_url: '',
          provider_config: JSON.stringify(data.vendorConfig),
          created_at: db.fn.now(),
          updated_at: db.fn.now()
        })
        .returning('*');

      console.log(`✅ Created email provider: ${provider.name} (${provider.id})`);
      
      return this.mapDbRowToProvider(provider);
    } catch (error: any) {
      console.error('Error creating email provider:', error);
      throw new Error(`Failed to create email provider: ${error.message}`);
    }
  }

  /**
   * Update an existing email provider
   */
  async updateProvider(providerId: string, data: UpdateProviderData): Promise<EmailProviderConfig> {
    try {
      const db = await this.getDb();
      const updateData: any = {
        updated_at: db.fn.now()
      };

      if (data.providerName !== undefined) {
        updateData.name = data.providerName;
      }

      if (data.mailbox !== undefined) {
        updateData.mailbox = data.mailbox;
      }

      if (data.isActive !== undefined) {
        updateData.active = data.isActive;
      }

      if (data.vendorConfig !== undefined) {
        // Merge with existing vendor config
        const existingProvider = await this.getProvider(providerId);
        if (existingProvider) {
          const mergedConfig = {
            ...existingProvider.provider_config,
            ...data.vendorConfig
          };
          updateData.provider_config = JSON.stringify(mergedConfig);
        } else {
          updateData.provider_config = JSON.stringify(data.vendorConfig);
        }
      }

      const [provider] = await db('email_provider_configs')
        .where('id', providerId)
        .update(updateData)
        .returning('*');

      if (!provider) {
        throw new Error('Provider not found');
      }

      console.log(`✅ Updated email provider: ${provider.name} (${provider.id})`);
      
      return this.mapDbRowToProvider(provider);
    } catch (error: any) {
      console.error(`Error updating email provider ${providerId}:`, error);
      throw new Error(`Failed to update email provider: ${error.message}`);
    }
  }

  /**
   * Update provider status
   */
  async updateProviderStatus(providerId: string, status: ProviderStatus): Promise<void> {
    try {
      const db = await this.getDb();
      const updateData: any = {
        connection_status: status.status,
        updated_at: db.fn.now()
      };

      if (status.errorMessage !== undefined) {
        updateData.connection_error_message = status.errorMessage;
      }

      if (status.lastSyncAt) {
        updateData.last_connection_test = status.lastSyncAt;
      }

      await db('email_provider_configs')
        .where('id', providerId)
        .update(updateData);

      console.log(`✅ Updated provider status: ${providerId} -> ${status.status}`);
    } catch (error: any) {
      console.error(`Error updating provider status ${providerId}:`, error);
      throw new Error(`Failed to update provider status: ${error.message}`);
    }
  }

  /**
   * Delete an email provider
   */
  async deleteProvider(providerId: string): Promise<void> {
    try {
      const db = await this.getDb();
      const deleted = await db('email_provider_configs')
        .where('id', providerId)
        .del();

      if (deleted === 0) {
        throw new Error('Provider not found');
      }

      console.log(`✅ Deleted email provider: ${providerId}`);
    } catch (error: any) {
      console.error(`Error deleting email provider ${providerId}:`, error);
      throw new Error(`Failed to delete email provider: ${error.message}`);
    }
  }

  /**
   * Initialize webhook for a provider
   */
  async initializeProviderWebhook(providerId: string): Promise<void> {
    try {
      const provider = await this.getProvider(providerId);
      if (!provider) {
        throw new Error('Provider not found');
      }

      console.log(`🔗 Initializing webhook for provider: ${provider.name}`);

      if (provider.provider_type === 'microsoft') {
        const adapter = new MicrosoftGraphAdapter(provider);
        const webhookUrl = this.generateWebhookUrl('/api/email/webhooks/microsoft');
        const result = await adapter.initializeWebhook(webhookUrl);
        
        if (!result.success) {
          throw new Error(result.error);
        }

        // Update provider with webhook subscription ID
        await this.updateProvider(providerId, {
          vendorConfig: {
            ...provider.provider_config,
            subscriptionId: result.subscriptionId
          }
        });

      } else if (provider.provider_type === 'google') {
        const gmailWebhookService = GmailWebhookService.getInstance();
        const webhookUrl = this.generateWebhookUrl('/api/email/webhooks/google');
        
        console.log(`🌐 Using webhook URL: ${webhookUrl}`);

        console.log(provider.provider_config);
        
        if (!provider.provider_config?.project_id || !provider.provider_config?.pubsub_topic_name) {
          throw new Error('Missing required Google Cloud configuration (project_id, pubsub_topic_name)');
        }

        const result = await gmailWebhookService.setupGmailWebhook(provider, {
          projectId: provider.provider_config.project_id,
          topicName: provider.provider_config.pubsub_topic_name,
          subscriptionName: provider.provider_config.pubsub_subscription_name,
          webhookUrl
        });

        if (!result.success) {
          throw new Error(result.error);
        }

        // Update provider with webhook details
        await this.updateProvider(providerId, {
          vendorConfig: {
            ...provider.provider_config,
            historyId: result.historyId,
            expiration: result.expiration
          }
        });
      }

      // Update status to connected
      await this.updateProviderStatus(providerId, {
        status: 'connected',
        errorMessage: null
      });

      console.log(`✅ Webhook initialized for provider: ${provider.name}`);
    } catch (error: any) {
      console.error(`❌ Failed to initialize webhook for provider ${providerId}:`, error);
      
      // Update status to error
      await this.updateProviderStatus(providerId, {
        status: 'error',
        errorMessage: error.message
      });
      
      throw error;
    }
  }

  /**
   * Deactivate webhook for a provider
   */
  async deactivateProviderWebhook(providerId: string): Promise<void> {
    try {
      const provider = await this.getProvider(providerId);
      if (!provider) {
        throw new Error('Provider not found');
      }

      console.log(`🔌 Deactivating webhook for provider: ${provider.name}`);

      if (provider.provider_type === 'google') {
        const gmailWebhookService = GmailWebhookService.getInstance();
        
        if (provider.provider_config?.project_id && provider.provider_config?.pubsub_topic_name) {
          const webhookUrl = this.generateWebhookUrl('/api/email/webhooks/google');
          
          await gmailWebhookService.removeGmailWebhook(provider, {
            projectId: provider.provider_config.project_id,
            topicName: provider.provider_config.pubsub_topic_name,
            subscriptionName: provider.provider_config.pubsub_subscription_name,
            webhookUrl
          });
        }
      }

      // Update status to disconnected
      await this.updateProviderStatus(providerId, {
        status: 'disconnected',
        errorMessage: null
      });

      console.log(`✅ Webhook deactivated for provider: ${provider.name}`);
    } catch (error: any) {
      console.error(`❌ Failed to deactivate webhook for provider ${providerId}:`, error);
      throw error;
    }
  }

  /**
   * Map database row to EmailProviderConfig interface
   */
  private mapCurrentDbRowToProvider(row: any, vendorConfig: any): EmailProviderConfig {
    return {
      id: row.id,
      tenant: row.tenant,
      name: row.provider_name,
      provider_type: row.provider_type,
      mailbox: row.mailbox,
      folder_to_monitor: 'Inbox', // Default for current implementation
      active: row.is_active,
      webhook_notification_url: vendorConfig?.webhook_notification_url || '',
      webhook_subscription_id: vendorConfig?.webhook_subscription_id || null,
      webhook_verification_token: vendorConfig?.webhook_verification_token || null,
      webhook_expires_at: vendorConfig?.webhook_expires_at || null,
      last_subscription_renewal: vendorConfig?.last_subscription_renewal || null,
      connection_status: row.status || 'configuring',
      last_connection_test: row.last_sync_at || null,
      connection_error_message: row.error_message || null,
      provider_config: vendorConfig || {},
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  /**
   * @deprecated This method is for the old table structure
   * Use mapCurrentDbRowToProvider instead
   */
  private mapDbRowToProvider(row: any): EmailProviderConfig {
    // This method is deprecated but kept for backward compatibility
    // with any remaining code that hasn't been updated
    console.warn('mapDbRowToProvider is deprecated. Use mapCurrentDbRowToProvider instead.');
    return this.mapCurrentDbRowToProvider(row, {});
  }
}

/**
 * Global function to get email provider configurations (used by other services)
 */
export async function getEmailProviderConfigs(filters?: Partial<GetProvidersFilter>): Promise<EmailProviderConfig[]> {
  const service = new EmailProviderService();
  return service.getProviders(filters as GetProvidersFilter);
}