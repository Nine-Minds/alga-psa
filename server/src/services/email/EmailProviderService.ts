/**
 * Email Provider Service
 * Handles CRUD operations for email provider configurations
 */

import { createTenantKnex } from '../../lib/db';
import { EmailProviderConfig } from '../../interfaces/email.interfaces';
import { MicrosoftGraphAdapter } from './providers/MicrosoftGraphAdapter';
import { GmailAdapter } from './providers/GmailAdapter';
import { GmailWebhookService } from './GmailWebhookService';
import { EmailProviderValidator } from './EmailProviderValidator';

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
   * Get email providers based on filters
   */
  async getProviders(filters: GetProvidersFilter): Promise<EmailProviderConfig[]> {
    try {
      const db = await this.getDb();
      let query = db('email_provider_configs')
        .where('tenant', filters.tenant)
        .orderBy('created_at', 'desc');

      if (filters.providerType) {
        query = query.where('provider_type', filters.providerType);
      }

      if (filters.isActive !== undefined) {
        query = query.where('active', filters.isActive);
      }

      if (filters.mailbox) {
        query = query.where('mailbox', filters.mailbox);
      }

      const providers = await query;
      
      return providers.map(this.mapDbRowToProvider);
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
      const provider = await db('email_provider_configs')
        .where('id', providerId)
        .first();

      if (!provider) {
        return null;
      }

      return this.mapDbRowToProvider(provider);
    } catch (error: any) {
      console.error(`Error fetching email provider ${providerId}:`, error);
      throw new Error(`Failed to fetch email provider: ${error.message}`);
    }
  }

  /**
   * Create a new email provider
   */
  async createProvider(data: CreateProviderData): Promise<EmailProviderConfig> {
    // Validate input data
    const validationErrors = EmailProviderValidator.validateCreateProvider(data);
    if (validationErrors.length > 0) {
      const errorMessage = EmailProviderValidator.formatValidationErrors(validationErrors);
      throw new Error(errorMessage);
    }

    try {
      const db = await this.getDb();
      
      // Sanitize input data
      const sanitizedData = {
        tenant: data.tenant,
        provider_type: data.providerType,
        name: data.providerName.trim(),
        mailbox: data.mailbox.trim().toLowerCase(),
        folder_to_monitor: 'Inbox',
        active: data.isActive,
        connection_status: 'disconnected',
        webhook_notification_url: '',
        provider_config: JSON.stringify(data.vendorConfig || {}),
        created_at: db.fn.now(),
        updated_at: db.fn.now()
      };

      const [provider] = await db('email_provider_configs')
        .insert({
          id: db.raw('gen_random_uuid()'),
          ...sanitizedData
        })
        .returning('*');

      console.log(`✅ Created email provider: ${provider.name} (${provider.id})`);
      
      return this.mapDbRowToProvider(provider);
    } catch (error: any) {
      console.error('Error creating email provider:', error);
      
      // Provide more user-friendly error messages for common database errors
      if (error.code === '23505') { // Unique constraint violation
        throw new Error('An email provider with this configuration already exists');
      } else if (error.code === '23503') { // Foreign key violation
        throw new Error('Invalid tenant specified');
      } else if (error.code === '23514') { // Check constraint violation
        throw new Error('Invalid provider type. Must be either "google" or "microsoft"');
      } else if (error.code === '23502') { // Not null violation
        throw new Error('Required field is missing');
      }
      
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
        const webhookUrl = `${process.env.NEXTAUTH_URL}/api/email/webhooks/microsoft`;
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
        const webhookUrl = `${process.env.NEXTAUTH_URL}/api/email/webhooks/google`;
        
        if (!provider.provider_config?.projectId || !provider.provider_config?.pubsubTopic) {
          throw new Error('Missing required Google Cloud configuration (projectId, pubsubTopic)');
        }

        const result = await gmailWebhookService.setupGmailWebhook(provider, {
          projectId: provider.provider_config.projectId,
          topicName: provider.provider_config.pubsubTopic,
          subscriptionName: provider.provider_config.pubsubTopic + '-subscription',
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
        
        if (provider.provider_config?.projectId && provider.provider_config?.pubsubTopic) {
          await gmailWebhookService.removeGmailWebhook(provider, {
            projectId: provider.provider_config.projectId,
            topicName: provider.provider_config.pubsubTopic,
            subscriptionName: provider.provider_config.pubsubTopic + '-subscription',
            webhookUrl: `${process.env.NEXTAUTH_URL}/api/email/webhooks/google`
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
  private mapDbRowToProvider(row: any): EmailProviderConfig {
    return {
      id: row.id,
      tenant: row.tenant,
      name: row.name,
      provider_type: row.provider_type,
      mailbox: row.mailbox,
      folder_to_monitor: row.folder_to_monitor || 'Inbox',
      active: row.active,
      webhook_notification_url: row.webhook_notification_url || '',
      webhook_subscription_id: row.webhook_subscription_id,
      webhook_verification_token: row.webhook_verification_token,
      webhook_expires_at: row.webhook_expires_at,
      last_subscription_renewal: row.last_subscription_renewal,
      connection_status: row.connection_status,
      last_connection_test: row.last_connection_test,
      connection_error_message: row.connection_error_message,
      provider_config: typeof row.provider_config === 'string' 
        ? JSON.parse(row.provider_config) 
        : row.provider_config,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }
}

/**
 * Global function to get email provider configurations (used by other services)
 */
export async function getEmailProviderConfigs(filters?: Partial<GetProvidersFilter>): Promise<EmailProviderConfig[]> {
  const service = new EmailProviderService();
  return service.getProviders(filters as GetProvidersFilter);
}