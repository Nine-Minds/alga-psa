/**
 * Email Provider Service
 * Handles CRUD operations for email provider configurations
 */

import { createTenantKnex, tenantDb, withTransaction, type TenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import { EmailProviderConfig } from '@alga-psa/shared/interfaces/inbound-email.interfaces';
import { MicrosoftGraphAdapter } from '@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter';
import { buildMicrosoftEmailProviderConfig } from '@alga-psa/shared/services/email/microsoftEmailProviderConfig';
import { EmailWebhookMaintenanceService } from '@alga-psa/shared/services/email/EmailWebhookMaintenanceService';
import {
  EmailProviderLifecycleService,
  type InboundPauseReason,
  type ResumeProviderResult,
} from '@alga-psa/shared/services/email/EmailProviderLifecycleService';
import { GmailAdapter } from './providers/GmailAdapter';
import { GmailWebhookService } from './GmailWebhookService';
import { getWebhookBaseUrl } from '../../utils/email/webhookHelpers';

export interface CreateProviderData {
  tenant: string;
  providerType: 'microsoft' | 'google' | 'imap';
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
  providerType?: 'microsoft' | 'google' | 'imap';
  isActive?: boolean;
  mailbox?: string;
}

export interface ProviderStatus {
  status: 'connected' | 'disconnected' | 'error' | 'configuring';
  errorMessage?: string | null;
  lastSyncAt?: string;
}

// Real writable columns on microsoft_email_provider_config (identity columns
// email_provider_id/tenant and the timestamp columns are managed separately).
// Only these may ever reach an UPDATE so a stray caller key (e.g.
// `subscriptionId`) can never be written to a nonexistent column.
const MICROSOFT_PROVIDER_CONFIG_COLUMNS = [
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
  'last_reconciliation_at',
  'microsoft_profile_id',
  'client_secret_ref',
] as const;

export class EmailProviderService {
  // LEVERAGE: pattern email-provider-service-twin — server/ and packages/integrations/ carry diverging copies of EmailProviderService; the create/update/vendor-config logic has drifted (missing IMAP tenant, Microsoft column allowlist only in packages)
  private readonly lifecycleService = new EmailProviderLifecycleService();
  private async getDb(tenant: string) {
    const { knex } = await createTenantKnex(tenant);
    return knex;
  }

  /**
   * Generate webhook URL with proper environment-aware base URL
   * Uses dynamic URL resolution that checks ngrok file in development mode
   */
  private generateWebhookUrl(path: string): string {
    const baseUrl = getWebhookBaseUrl();
    return `${baseUrl}${path}`;
  }

  /**
   * Get email providers based on filters
   */
  async getProviders(filters: GetProvidersFilter): Promise<EmailProviderConfig[]> {
    try {
      const db = await this.getDb(filters.tenant);
      const scopedDb = tenantDb(db, filters.tenant);
      let query = scopedDb.table('email_providers')
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
      
      const configs = await this.loadVendorConfigsByProviderId(scopedDb, providers);
      return providers.map((p) => this.mapCurrentDbRowToProvider(p, configs.get(p.id) ?? null));
    } catch (error: any) {
      console.error('Error fetching email providers:', error);
      throw new Error(`Failed to fetch email providers: ${error.message}`);
    }
  }

  /**
   * Get a single email provider by ID
   */
  async getProvider(providerId: string, tenant: string): Promise<EmailProviderConfig | null> {
    try {
      const db = await this.getDb(tenant);
      const scopedDb = tenantDb(db, tenant);
      const provider = await scopedDb.table('email_providers')
        .where('id', providerId)
        .first();

      if (!provider) {
        return null;
      }

      // Load vendor-specific configuration
      let vendorConfig = null;
      if (provider.provider_type === 'google') {
        vendorConfig = await scopedDb.table('google_email_provider_config')
          .where('email_provider_id', providerId)
          .first();
      } else if (provider.provider_type === 'microsoft') {
        vendorConfig = await scopedDb.table('microsoft_email_provider_config')
          .where('email_provider_id', providerId)
          .first();
      } else if (provider.provider_type === 'imap') {
        vendorConfig = await scopedDb.table('imap_email_provider_config')
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
   * Create a new email provider.
   *
   * The provider row and its vendor-config row are written atomically. If a
   * caller transaction is passed it is joined (the caller owns commit/rollback);
   * otherwise the service opens its own transaction.
   */
  async createProvider(
    data: CreateProviderData,
    knexOrTrx?: Knex | Knex.Transaction
  ): Promise<EmailProviderConfig> {
    try {
      const conn = knexOrTrx ?? (await this.getDb(data.tenant));
      const created = await withTransaction(conn, async (trx) => {
        const db = tenantDb(trx, data.tenant);

        // Create main provider record
        const [providerRow] = await db.table('email_providers')
          .insert({
            id: trx.raw('gen_random_uuid()'),
            tenant: data.tenant,
            provider_type: data.providerType,
            provider_name: data.providerName,
            mailbox: data.mailbox,
            is_active: data.isActive,
            status: 'configuring',
            created_at: trx.fn.now(),
            updated_at: trx.fn.now()
          })
          .returning('*');

        // Create vendor-specific configuration
        const vendorRow = await this.insertVendorConfig(db, trx, providerRow.id, data);

        return this.mapCurrentDbRowToProvider(providerRow, vendorRow);
      });

      console.log(`✅ Created email provider: ${created.name} (${created.id})`);

      return created;
    } catch (error: any) {
      console.error('Error creating email provider:', error);
      throw new Error(`Failed to create email provider: ${error.message}`);
    }
  }

  private async insertVendorConfig(
    db: TenantDb,
    trx: Knex.Transaction,
    providerId: string,
    data: CreateProviderData
  ): Promise<any | null> {
    if (data.providerType === 'google') {
      const insertPayload = { ...data.vendorConfig };

      // Ensure label_filters is properly JSON-stringified for jsonb column
      if (insertPayload.label_filters && Array.isArray(insertPayload.label_filters)) {
        insertPayload.label_filters = JSON.stringify(insertPayload.label_filters);
      }

      const rows = await db.table('google_email_provider_config')
        .insert({
          email_provider_id: providerId,
          tenant: data.tenant,
          ...insertPayload,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now()
        })
        .returning('*');
      return rows[0] ?? null;
    } else if (data.providerType === 'microsoft') {
      const rows = await db.table('microsoft_email_provider_config')
        .insert({
          email_provider_id: providerId,
          tenant: data.tenant,
          ...data.vendorConfig,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now()
        })
        .returning('*');
      return rows[0] ?? null;
    } else if (data.providerType === 'imap') {
      const insertPayload = { ...data.vendorConfig };
      if (insertPayload.folder_filters && Array.isArray(insertPayload.folder_filters)) {
        insertPayload.folder_filters = JSON.stringify(insertPayload.folder_filters);
      }
      const rows = await db.table('imap_email_provider_config')
        .insert({
          email_provider_id: providerId,
          tenant: data.tenant,
          ...insertPayload,
          created_at: trx.fn.now(),
          updated_at: trx.fn.now()
        })
        .returning('*');
      return rows[0] ?? null;
    }
    return null;
  }

  /**
   * Update an existing email provider
   */
  async updateProvider(providerId: string, tenant: string, data: UpdateProviderData): Promise<EmailProviderConfig> {
    try {
      const db = await this.getDb(tenant);
      const scopedDb = tenantDb(db, tenant);

      // Get existing provider to determine type and current config
      const existingProvider = await this.getProvider(providerId, tenant);
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

      if (data.mailbox !== undefined) {
        mainUpdateData.mailbox = data.mailbox;
      }

      if (data.isActive !== undefined) {
        mainUpdateData.is_active = data.isActive;
      }

      // Update main provider record
      await scopedDb.table('email_providers')
        .where('id', providerId)
        .update(mainUpdateData);

      // Update vendor-specific configuration if provided
      if (data.vendorConfig !== undefined) {
        const mergedConfig = {
          ...existingProvider.provider_config,
          ...data.vendorConfig
        };

        if (existingProvider.provider_type === 'google') {
          // Update Google-specific configuration
          const updatePayload = { ...mergedConfig };
          
          // Ensure label_filters is properly JSON-stringified for jsonb column
          if (updatePayload.label_filters && Array.isArray(updatePayload.label_filters)) {
            updatePayload.label_filters = JSON.stringify(updatePayload.label_filters);
          }
          
          await scopedDb.table('google_email_provider_config')
            .where('email_provider_id', providerId)
            .update({
              ...updatePayload,
              updated_at: db.fn.now()
            });
        } else if (existingProvider.provider_type === 'microsoft') {
          // Update Microsoft-specific configuration. Only real
          // microsoft_email_provider_config columns may reach the UPDATE: the
          // merged config carries the existing row plus caller keys, and a
          // non-column key (e.g. `subscriptionId`) would make Postgres throw,
          // leaving the provider in Error. folder_filters is a jsonb column
          // that the pg driver returns as a parsed array, so it must be
          // re-stringified before it can be written back.
          const microsoftUpdate: Record<string, unknown> = { updated_at: db.fn.now() };
          for (const column of MICROSOFT_PROVIDER_CONFIG_COLUMNS) {
            const value = (mergedConfig as Record<string, unknown>)[column];
            if (value === undefined) continue;
            microsoftUpdate[column] =
              column === 'folder_filters' && Array.isArray(value)
                ? JSON.stringify(value)
                : value;
          }
          await scopedDb.table('microsoft_email_provider_config')
            .where('email_provider_id', providerId)
            .update(microsoftUpdate);
        } else if (existingProvider.provider_type === 'imap') {
          const updatePayload = { ...mergedConfig };
          if (updatePayload.folder_filters && Array.isArray(updatePayload.folder_filters)) {
            updatePayload.folder_filters = JSON.stringify(updatePayload.folder_filters);
          }
          await scopedDb.table('imap_email_provider_config')
            .where('email_provider_id', providerId)
            .update({
              ...updatePayload,
              updated_at: db.fn.now()
            });
        }
      }

      // Fetch updated provider with vendor config
      const updatedProvider = await this.getProvider(providerId, tenant);
      if (!updatedProvider) {
        throw new Error('Failed to fetch updated provider');
      }

      console.log(`✅ Updated email provider: ${updatedProvider.name} (${updatedProvider.id})`);

      return updatedProvider;
    } catch (error: any) {
      console.error(`Error updating email provider ${providerId}:`, error);
      throw new Error(`Failed to update email provider: ${error.message}`);
    }
  }

  /**
   * Update provider status
   */
  async updateProviderStatus(providerId: string, tenant: string, status: ProviderStatus): Promise<void> {
    try {
      const db = await this.getDb(tenant);
      const scopedDb = tenantDb(db, tenant);
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

      await scopedDb.table('email_providers')
        .where('id', providerId)
        .update(updateData);

      console.log(`✅ Updated provider status: ${providerId} -> ${status.status}`);
    } catch (error: any) {
      console.error(`Error updating provider status ${providerId}:`, error);
      throw new Error(`Failed to update provider status: ${error.message}`);
    }
  }

  /**
   * Pause inbound ingestion without changing the provider's configured active state.
   */
  async pauseProvider(
    providerId: string,
    tenant: string,
    reason: InboundPauseReason
  ): Promise<boolean> {
    return this.lifecycleService.pauseProvider(providerId, tenant, reason);
  }

  /**
   * Resume inbound ingestion and recreate webhook-mode subscriptions.
   */
  async resumeProvider(providerId: string, tenant: string): Promise<ResumeProviderResult> {
    return this.lifecycleService.resumeProvider(providerId, tenant);
  }

  /**
   * Delete an email provider
   */
  async deleteProvider(providerId: string, tenant: string): Promise<void> {
    await this.lifecycleService.deleteProvider(providerId, tenant);
    console.log(`✅ Deleted email provider: ${providerId}`);
  }

  /**
   * Initialize webhook for a provider
   */
  async initializeProviderWebhook(providerId: string, tenant: string): Promise<void> {
    try {
      const provider = await this.getProvider(providerId, tenant);
      if (!provider) {
        throw new Error('Provider not found');
      }

      console.log(`🔗 Initializing webhook for provider: ${provider.name}`);

      if (provider.provider_type === 'microsoft') {
        const adapter = new MicrosoftGraphAdapter(await buildMicrosoftEmailProviderConfig(provider));
        const webhookUrl = this.generateWebhookUrl('/api/email/webhooks/microsoft');
        const result = await adapter.initializeWebhook(webhookUrl);
        
        if (!result.success) {
          if (result.errorKind === 'validation') {
            await new EmailWebhookMaintenanceService().usePollingDelivery({
              providerId,
              tenant,
              reason: result.error || 'Microsoft webhook endpoint validation failed',
            });
            return;
          }
          throw new Error(result.error);
        }

        await new EmailWebhookMaintenanceService().recordWebhookDeliveryMode({
          providerId,
          tenant,
          reason: 'provider configuration subscription succeeded',
        });

        // The adapter already persisted the replacement subscription id and
        // expiry (webhook_subscription_id / webhook_expires_at on
        // microsoft_email_provider_config) inside registerWebhookSubscription,
        // and it rethrows a persistence failure so webhookCompensation can
        // delete the orphaned Graph subscription. Writing it again here would
        // only duplicate that write with a wrong column name (`subscriptionId`
        // is not a column), so nothing is done.

      } else if (provider.provider_type === 'google') {
        const gmailWebhookService = GmailWebhookService.getInstance();
        const webhookUrl = this.generateWebhookUrl('/api/email/webhooks/google');
        
        console.log(`🌐 Using webhook URL: ${webhookUrl}`);

        console.log(provider.provider_config);
        
        if (!provider.provider_config?.project_id || !provider.provider_config?.pubsub_topic_name) {
          throw new Error('Missing required Google Cloud configuration (project_id, pubsub_topic_name)');
        }

        const result = await gmailWebhookService.registerWatch(provider, {
          projectId: provider.provider_config.project_id!,
          topicName: provider.provider_config.pubsub_topic_name!,
          subscriptionName: provider.provider_config.pubsub_subscription_name!,
          webhookUrl
        });

        if (!result.success) {
          throw new Error(result.error);
        }

        // Update provider with webhook details
        await this.updateProvider(providerId, tenant, {
          vendorConfig: {
            ...provider.provider_config,
            history_id: result.historyId,
            watch_expiration: result.expiration
          }
        });
      }

      // Update status to connected
      await this.updateProviderStatus(providerId, tenant, {
        status: 'connected',
        errorMessage: null,
        lastSyncAt: new Date().toISOString()
      });

      console.log(`✅ Webhook initialized for provider: ${provider.name}`);
    } catch (error: any) {
      console.error(`❌ Failed to initialize webhook for provider ${providerId}:`, error);

      // Update status to error
      await this.updateProviderStatus(providerId, tenant, {
        status: 'error',
        errorMessage: error.message
      });

      throw error;
    }
  }

  /**
   * Deactivate webhook for a provider
   */
  async deactivateProviderWebhook(providerId: string, tenant: string): Promise<void> {
    try {
      const provider = await this.getProvider(providerId, tenant);
      if (!provider) {
        throw new Error('Provider not found');
      }

      console.log(`🔌 Deactivating webhook for provider: ${provider.name}`);

      if (provider.provider_type === 'google') {
        const gmailWebhookService = GmailWebhookService.getInstance();
        
        if (provider.provider_config?.project_id && provider.provider_config?.pubsub_topic_name) {
          const webhookUrl = this.generateWebhookUrl('/api/email/webhooks/google');
          
          await gmailWebhookService.removeGmailWebhook(provider, {
            projectId: provider.provider_config.project_id!,
            topicName: provider.provider_config.pubsub_topic_name!,
            subscriptionName: provider.provider_config.pubsub_subscription_name!,
            webhookUrl
          });
        }
      }

      // Update status to disconnected
      await this.updateProviderStatus(providerId, tenant, {
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
   * Load vendor config rows for a provider list, one batched query per vendor
   * table, run sequentially so at most one pool connection is in use.
   */
  // LEVERAGE: pattern provider-vendor-config-load — same per-type vendor-config
  // loader in server + packages/integrations EmailProviderService and the three
  // CalendarProviderService copies; candidate for a shared batched loader.
  private async loadVendorConfigsByProviderId(
    scopedDb: TenantDb,
    providers: Array<{ id: string; provider_type: string }>
  ): Promise<Map<string, any>> {
    const tables = {
      google: 'google_email_provider_config',
      microsoft: 'microsoft_email_provider_config',
      imap: 'imap_email_provider_config',
    } as const;
    const byId = new Map<string, any>();
    for (const [type, table] of Object.entries(tables)) {
      const ids = providers.filter((p) => p.provider_type === type).map((p) => p.id);
      if (ids.length === 0) continue;
      // Sequential by design: avoids pool fan-out.
      const rows = await scopedDb.table(table).whereIn('email_provider_id', ids);
      for (const row of rows) byId.set(row.email_provider_id, row);
    }
    return byId;
  }

  /**
   * Map database row to EmailProviderConfig interface
   */
  private mapCurrentDbRowToProvider(row: any, vendorConfig: any): EmailProviderConfig {
    const webhookPath = row.provider_type === 'microsoft' 
      ? '/api/email/webhooks/microsoft' 
      : row.provider_type === 'google'
      ? '/api/email/webhooks/google'
      : '/api/email/webhooks/imap';

    return {
      id: row.id,
      tenant: row.tenant,
      name: row.provider_name,
      provider_type: row.provider_type,
      mailbox: row.mailbox,
      folder_to_monitor: 'Inbox', // Default for current implementation
      active: row.is_active,
      inboundPausedAt: row.inbound_paused_at || null,
      inboundPauseReason: row.inbound_pause_reason || null,
      webhook_notification_url: this.generateWebhookUrl(webhookPath),
      webhook_subscription_id: vendorConfig?.webhook_subscription_id || null,
      webhook_verification_token: vendorConfig?.webhook_verification_token || null,
      webhook_expires_at: vendorConfig?.webhook_expires_at || null,
      last_subscription_renewal: vendorConfig?.last_subscription_renewal || null,
      delivery_mode: vendorConfig?.delivery_mode ||
        (vendorConfig?.webhook_subscription_id ? 'webhook' : 'polling'),
      last_webhook_delivery_at: vendorConfig?.last_webhook_delivery_at || null,
      webhook_silent_runs: vendorConfig?.webhook_silent_runs || 0,
      next_subscription_probe_at: vendorConfig?.next_subscription_probe_at || null,
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
