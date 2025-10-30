/**
 * Calendar Provider Service
 * Handles CRUD operations for calendar provider configurations
 */

import { createTenantKnex } from '../../lib/db';
import { CalendarProviderConfig } from '../../interfaces/calendar.interfaces';

export interface CreateCalendarProviderData {
  tenant: string;
  providerType: 'google' | 'microsoft';
  providerName: string;
  calendarId: string;
  isActive: boolean;
  syncDirection: 'bidirectional' | 'to_external' | 'from_external';
  vendorConfig: any;
}

export interface UpdateCalendarProviderData {
  providerName?: string;
  calendarId?: string;
  isActive?: boolean;
  syncDirection?: 'bidirectional' | 'to_external' | 'from_external';
  vendorConfig?: any;
}

export interface GetCalendarProvidersFilter {
  tenant: string;
  providerType?: 'google' | 'microsoft';
  isActive?: boolean;
  calendarId?: string;
}

export interface CalendarProviderStatus {
  status: 'connected' | 'disconnected' | 'error' | 'configuring';
  errorMessage?: string | null;
  lastSyncAt?: string;
}

export class CalendarProviderService {
  private async getDb() {
    const { knex } = await createTenantKnex();
    return knex;
  }

  /**
   * Generate webhook URL with proper environment-aware base URL
   */
  private generateWebhookUrl(path: string): string {
    const baseUrl = process.env.NGROK_URL || 
                    process.env.NEXT_PUBLIC_BASE_URL || 
                    process.env.NEXTAUTH_URL ||
                    'http://localhost:3000';
    return `${baseUrl}${path}`;
  }

  /**
   * Get calendar providers based on filters
   */
  async getProviders(filters: GetCalendarProvidersFilter): Promise<CalendarProviderConfig[]> {
    try {
      const db = await this.getDb();
      let query = db('calendar_providers')
        .where('tenant', filters.tenant)
        .orderBy('created_at', 'desc');

      if (filters.providerType) {
        query = query.where('provider_type', filters.providerType);
      }

      if (filters.isActive !== undefined) {
        query = query.where('is_active', filters.isActive);
      }

      if (filters.calendarId) {
        query = query.where('calendar_id', filters.calendarId);
      }

      const providers = await query;
      
      // Load vendor configs for each provider
      const providersWithConfig = await Promise.all(providers.map(async (provider) => {
        let vendorConfig = null;
        if (provider.provider_type === 'google') {
          vendorConfig = await db('google_calendar_provider_config')
            .where('calendar_provider_id', provider.id)
            .andWhere('tenant', filters.tenant)
            .first();
        } else if (provider.provider_type === 'microsoft') {
          vendorConfig = await db('microsoft_calendar_provider_config')
            .where('calendar_provider_id', provider.id)
            .andWhere('tenant', filters.tenant)
            .first();
        }
        return this.mapDbRowToProvider(provider, vendorConfig);
      }));

      return providersWithConfig;
    } catch (error: any) {
      console.error('Error fetching calendar providers:', error);
      throw new Error(`Failed to fetch calendar providers: ${error.message}`);
    }
  }

  /**
   * Get a single calendar provider by ID
   */
  async getProvider(providerId: string): Promise<CalendarProviderConfig | null> {
    try {
      const db = await this.getDb();
      const provider = await db('calendar_providers')
        .where('id', providerId)
        .first();

      if (!provider) {
        return null;
      }

      // Load vendor-specific configuration
      let vendorConfig = null;
      if (provider.provider_type === 'google') {
        vendorConfig = await db('google_calendar_provider_config')
          .where('calendar_provider_id', providerId)
          .andWhere('tenant', provider.tenant)
          .first();
      } else if (provider.provider_type === 'microsoft') {
        vendorConfig = await db('microsoft_calendar_provider_config')
          .where('calendar_provider_id', providerId)
          .andWhere('tenant', provider.tenant)
          .first();
      }

      return this.mapDbRowToProvider(provider, vendorConfig);
    } catch (error: any) {
      console.error(`Error fetching calendar provider ${providerId}:`, error);
      throw new Error(`Failed to fetch calendar provider: ${error.message}`);
    }
  }

  /**
   * Create a new calendar provider
   */
  async createProvider(data: CreateCalendarProviderData): Promise<CalendarProviderConfig> {
    try {
      const db = await this.getDb();
      
      // Create main provider record
      const [provider] = await db('calendar_providers')
        .insert({
          id: db.raw('gen_random_uuid()'),
          tenant: data.tenant,
          provider_type: data.providerType,
          provider_name: data.providerName,
          calendar_id: data.calendarId,
          is_active: data.isActive,
          sync_direction: data.syncDirection,
          status: 'configuring',
          created_at: db.fn.now(),
          updated_at: db.fn.now()
        })
        .returning('*');

      // Create vendor-specific configuration
      if (data.providerType === 'google') {
        await db('google_calendar_provider_config')
          .insert({
            calendar_provider_id: provider.id,
            tenant: data.tenant,
            ...data.vendorConfig,
            created_at: db.fn.now(),
            updated_at: db.fn.now()
          });
      } else if (data.providerType === 'microsoft') {
        await db('microsoft_calendar_provider_config')
          .insert({
            calendar_provider_id: provider.id,
            tenant: data.tenant,
            ...data.vendorConfig,
            created_at: db.fn.now(),
            updated_at: db.fn.now()
          });
      }

      console.log(`✅ Created calendar provider: ${provider.provider_name} (${provider.id})`);
      
      // Fetch the complete provider with vendor config
      const createdProvider = await this.getProvider(provider.id);
      if (!createdProvider) {
        throw new Error('Failed to fetch created provider');
      }
      
      return createdProvider;
    } catch (error: any) {
      console.error('Error creating calendar provider:', error);
      throw new Error(`Failed to create calendar provider: ${error.message}`);
    }
  }

  /**
   * Update an existing calendar provider
   */
  async updateProvider(providerId: string, data: UpdateCalendarProviderData): Promise<CalendarProviderConfig> {
    try {
      const db = await this.getDb();
      
      // Get existing provider to determine type and current config
      const existingProvider = await this.getProvider(providerId);
      if (!existingProvider) {
        throw new Error('Provider not found');
      }

      // Update main provider table
      const mainUpdateData: any = {
        updated_at: db.fn.now()
      };

      if (data.providerName !== undefined) {
        mainUpdateData.provider_name = data.providerName;
      }

      if (data.calendarId !== undefined) {
        mainUpdateData.calendar_id = data.calendarId;
      }

      if (data.isActive !== undefined) {
        mainUpdateData.is_active = data.isActive;
      }

      if (data.syncDirection !== undefined) {
        mainUpdateData.sync_direction = data.syncDirection;
      }

      // Update main provider record
      await db('calendar_providers')
        .where('id', providerId)
        .update(mainUpdateData);

      // Update vendor-specific configuration if provided
      if (data.vendorConfig !== undefined) {
        const mergedConfig = {
          ...existingProvider.provider_config,
          ...data.vendorConfig
        };

        if (existingProvider.provider_type === 'google') {
          await db('google_calendar_provider_config')
            .where('calendar_provider_id', providerId)
            .andWhere('tenant', existingProvider.tenant)
            .update({
              ...mergedConfig,
              updated_at: db.fn.now()
            });
        } else if (existingProvider.provider_type === 'microsoft') {
          await db('microsoft_calendar_provider_config')
            .where('calendar_provider_id', providerId)
            .andWhere('tenant', existingProvider.tenant)
            .update({
              ...mergedConfig,
              updated_at: db.fn.now()
            });
        }
      }

      // Fetch updated provider with vendor config
      const updatedProvider = await this.getProvider(providerId);
      if (!updatedProvider) {
        throw new Error('Failed to fetch updated provider');
      }

      console.log(`✅ Updated calendar provider: ${updatedProvider.name} (${updatedProvider.id})`);
      
      return updatedProvider;
    } catch (error: any) {
      console.error(`Error updating calendar provider ${providerId}:`, error);
      throw new Error(`Failed to update calendar provider: ${error.message}`);
    }
  }

  /**
   * Update provider status
   */
  async updateProviderStatus(providerId: string, status: CalendarProviderStatus): Promise<void> {
    try {
      const db = await this.getDb();
      const updateData: any = {
        status: status.status,
        updated_at: db.fn.now()
      };

      if (status.errorMessage !== undefined) {
        updateData.error_message = status.errorMessage;
      }

      if (status.lastSyncAt) {
        updateData.last_sync_at = status.lastSyncAt;
      }

      await db('calendar_providers')
        .where('id', providerId)
        .update(updateData);

      console.log(`✅ Updated calendar provider status: ${providerId} -> ${status.status}`);
    } catch (error: any) {
      console.error(`Error updating calendar provider status ${providerId}:`, error);
      throw new Error(`Failed to update calendar provider status: ${error.message}`);
    }
  }

  /**
   * Delete a calendar provider
   */
  async deleteProvider(providerId: string): Promise<void> {
    try {
      const db = await this.getDb();
      
      // Get provider info to determine type for cleanup
      const provider = await db('calendar_providers')
        .where('id', providerId)
        .first();

      if (!provider) {
        throw new Error('Provider not found');
      }

      // Delete vendor-specific configuration first
      if (provider.provider_type === 'google') {
        await db('google_calendar_provider_config')
          .where('calendar_provider_id', providerId)
          .andWhere('tenant', provider.tenant)
          .del();
      } else if (provider.provider_type === 'microsoft') {
        await db('microsoft_calendar_provider_config')
          .where('calendar_provider_id', providerId)
          .andWhere('tenant', provider.tenant)
          .del();
      }

      // Delete calendar event mappings
      await db('calendar_event_mappings')
        .where('calendar_provider_id', providerId)
        .andWhere('tenant', provider.tenant)
        .del();

      // Delete main provider record
      const deleted = await db('calendar_providers')
        .where('id', providerId)
        .del();

      if (deleted === 0) {
        throw new Error('Provider not found');
      }

      console.log(`✅ Deleted calendar provider: ${providerId}`);
    } catch (error: any) {
      console.error(`Error deleting calendar provider ${providerId}:`, error);
      throw new Error(`Failed to delete calendar provider: ${error.message}`);
    }
  }

  /**
   * Map database row to CalendarProviderConfig interface
   */
  private mapDbRowToProvider(row: any, vendorConfig: any): CalendarProviderConfig {
    return {
      id: row.id,
      tenant: row.tenant,
      name: row.provider_name,
      provider_type: row.provider_type,
      calendar_id: row.calendar_id,
      active: row.is_active,
      sync_direction: row.sync_direction,
      connection_status: row.status || 'configuring',
      last_sync_at: row.last_sync_at || undefined,
      error_message: row.error_message || undefined,
      provider_config: vendorConfig ? {
        clientId: vendorConfig.client_id,
        clientSecret: vendorConfig.client_secret,
        accessToken: vendorConfig.access_token,
        refreshToken: vendorConfig.refresh_token,
        tokenExpiresAt: vendorConfig.token_expires_at,
        redirectUri: vendorConfig.redirect_uri,
        // Google-specific
        projectId: vendorConfig.project_id,
        pubsubTopicName: vendorConfig.pubsub_topic_name,
        pubsubSubscriptionName: vendorConfig.pubsub_subscription_name,
        pubsubInitialisedAt: vendorConfig.pubsub_initialised_at,
        // Microsoft-specific
        tenantId: vendorConfig.tenant_id,
        webhookSubscriptionId: vendorConfig.webhook_subscription_id,
        webhookExpiresAt: vendorConfig.webhook_expires_at,
        // Webhook configuration
        webhookNotificationUrl: vendorConfig.webhook_notification_url,
        webhookVerificationToken: vendorConfig.webhook_verification_token,
      } : undefined,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }
}

/**
 * Global function to get calendar provider configurations (used by other services)
 */
export async function getCalendarProviderConfigs(filters?: Partial<GetCalendarProvidersFilter>): Promise<CalendarProviderConfig[]> {
  const service = new CalendarProviderService();
  return service.getProviders(filters as GetCalendarProvidersFilter);
}

