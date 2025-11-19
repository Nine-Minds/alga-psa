import { getAdminConnection } from '../../db/admin';
import { EmailProviderConfig } from '../../interfaces/inbound-email.interfaces';
import { MicrosoftGraphAdapter } from './providers/MicrosoftGraphAdapter';
import logger from '../../core/logger';

interface RenewalOptions {
  tenantId?: string;
  providerId?: string;
  lookAheadMinutes?: number;
}

interface RenewalResult {
  providerId: string;
  tenant: string;
  success: boolean;
  action: 'renewed' | 'recreated' | 'failed' | 'skipped';
  newExpiration?: string;
  error?: string;
}

export class EmailWebhookMaintenanceService {
  
  constructor() {
    // No setup needed for logger
  }

  /**
   * Main entry point to renew Microsoft webhook subscriptions
   */
  async renewMicrosoftWebhooks(options: RenewalOptions = {}): Promise<RenewalResult[]> {
    const { tenantId, providerId, lookAheadMinutes = 1440 } = options;
    logger.info('Starting Microsoft webhook renewal check', { tenantId, providerId, lookAheadMinutes });

    try {
      const candidates = await this.findRenewalCandidates(lookAheadMinutes, tenantId, providerId);
      logger.info(`Found ${candidates.length} renewal candidates`);

      const results: RenewalResult[] = [];

      for (const candidate of candidates) {
        try {
          const result = await this.processCandidate(candidate);
          results.push(result);
        } catch (error: any) {
          logger.error(`Unexpected error processing provider ${candidate.id}`, error);
          results.push({
            providerId: candidate.id,
            tenant: candidate.tenant,
            success: false,
            action: 'failed',
            error: error.message
          });
        }
      }

      return results;
    } catch (error: any) {
      logger.error('Failed to execute renewal cycle', error);
      throw error;
    }
  }

  /**
   * Find providers that need renewal
   */
  private async findRenewalCandidates(lookAheadMinutes: number, tenantId?: string, providerId?: string): Promise<EmailProviderConfig[]> {
    const knex = await getAdminConnection();
    const now = new Date();
    const threshold = new Date(now.getTime() + lookAheadMinutes * 60000);

    let query = knex('email_providers as ep')
      .join('microsoft_email_provider_config as mpc', 'ep.id', 'mpc.email_provider_id')
      .where('ep.provider_type', 'microsoft')
      .andWhere('ep.is_active', true);

    // If providerId is specified, we ignore expiration/missing subscription logic and force check/renew
    if (!providerId) {
      query = query.andWhere(function() {
        this.whereNull('mpc.webhook_expires_at')
          .orWhere('mpc.webhook_expires_at', '<=', threshold.toISOString())
          .orWhereNull('mpc.webhook_subscription_id');
      });
    }

    if (tenantId) {
      query = query.andWhere('ep.tenant', tenantId);
    }

    if (providerId) {
      query = query.andWhere('ep.id', providerId);
    }

    // Select all columns needed to construct EmailProviderConfig
    const rows = await query.select(
      'ep.id',
      'ep.tenant',
      'ep.provider_name',
      'ep.provider_type',
      'ep.mailbox',
      'ep.is_active',
      'ep.status',
      'ep.last_sync_at',
      'ep.error_message',
      'ep.created_at',
      'ep.updated_at',
      'mpc.webhook_subscription_id',
      'mpc.webhook_verification_token',
      'mpc.webhook_expires_at',
      'mpc.last_subscription_renewal',
      // Select all vendor config columns as an object if possible, or spread them
      // For simplicity, we'll select the raw columns and map them manually as needed by the adapter
      'mpc.client_id',
      'mpc.client_secret',
      'mpc.tenant_id',
      'mpc.access_token',
      'mpc.refresh_token',
      'mpc.token_expires_at'
    );

    return rows.map(row => this.mapRowToConfig(row));
  }

  /**
   * Process a single renewal candidate
   */
  private async processCandidate(config: EmailProviderConfig): Promise<RenewalResult> {
    logger.info(`Processing renewal for ${config.name} (${config.id})`, { 
      tenant: config.tenant,
      currentExpiry: config.webhook_expires_at 
    });

    const adapter = new MicrosoftGraphAdapter(config);

    try {
      // Case 1: No subscription ID -> Register new
      if (!config.webhook_subscription_id) {
        logger.info(`No subscription ID for ${config.id}, registering new webhook`);
        return await this.recreateSubscription(adapter, config);
      }

      // Case 2: Has subscription ID -> Try to renew
      try {
        await adapter.renewWebhookSubscription();
        
        await this.updateHealthStatus(config.id, config.tenant, {
          subscription_status: 'healthy',
          last_renewal_result: 'success',
          failure_reason: null
        });

        return {
          providerId: config.id,
          tenant: config.tenant,
          success: true,
          action: 'renewed',
          newExpiration: config.webhook_expires_at // adapter updates the config object in place
        };
      } catch (error: any) {
        // check for 404 ResourceNotFound
        if (this.isResourceNotFoundError(error)) {
          logger.warn(`Subscription not found (404) for ${config.id}, attempting to recreate`);
          return await this.recreateSubscription(adapter, config);
        }
        
        throw error;
      }
    } catch (error: any) {
      logger.error(`Failed to renew/recreate subscription for ${config.id}`, error);
      
      await this.updateHealthStatus(config.id, config.tenant, {
        subscription_status: 'error',
        last_renewal_result: 'failure',
        failure_reason: error.message
      });

      return {
        providerId: config.id,
        tenant: config.tenant,
        success: false,
        action: 'failed',
        error: error.message
      };
    }
  }

  /**
   * Recreate a missing or expired subscription
   */
  private async recreateSubscription(adapter: MicrosoftGraphAdapter, config: EmailProviderConfig): Promise<RenewalResult> {
    // We need the webhook URL. The config object should have it populated from the DB row.
    // If not, we might need to regenerate it, but for now let's assume it's in the DB.
    if (!config.webhook_notification_url) {
        throw new Error('Cannot recreate subscription: webhook_notification_url is missing in config');
    }

    const result = await adapter.initializeWebhook(config.webhook_notification_url);
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to initialize webhook');
    }

    await this.updateHealthStatus(config.id, config.tenant, {
      subscription_status: 'healthy',
      last_renewal_result: 'success',
      failure_reason: null
    });

    return {
      providerId: config.id,
      tenant: config.tenant,
      success: true,
      action: 'recreated',
      newExpiration: adapter.getConfig().webhook_expires_at
    };
  }

  private isResourceNotFoundError(error: any): boolean {
    // Check for Graph API 404 structure
    if (error?.response?.status === 404) return true;
    if (error?.code === 'ResourceNotFound') return true;
    if (error?.message?.includes('ResourceNotFound')) return true;
    if (error?.message?.includes('Subscription not found')) return true;
    return false;
  }

  private async updateHealthStatus(providerId: string, tenant: string, status: {
    subscription_status: string;
    last_renewal_result: string;
    failure_reason: string | null;
  }): Promise<void> {
    try {
      const knex = await getAdminConnection();
      const now = new Date().toISOString();
      
      // Check if health row exists, if not create it
      const existing = await knex('email_provider_health')
        .where('provider_id', providerId)
        .first();

      if (existing) {
        await knex('email_provider_health')
          .where('provider_id', providerId)
          .update({
            ...status,
            last_renewal_attempt_at: now,
            updated_at: now
          });
      } else {
        await knex('email_provider_health')
          .insert({
            provider_id: providerId,
            tenant_id: tenant,
            provider_type: 'microsoft', // We know it's microsoft here
            ...status,
            last_renewal_attempt_at: now,
            created_at: now,
            updated_at: now
          });
      }
    } catch (error) {
      logger.warn(`Failed to update health status for ${providerId}`, error);
    }
  }

  private getBaseUrl(): string {
    const envApplicationUrl = process.env.APPLICATION_URL || 
                              process.env.NEXTAUTH_URL || 
                              process.env.NEXT_PUBLIC_BASE_URL;

    if (!envApplicationUrl || envApplicationUrl === 'www.algapsa.com') {
      return 'https://algapsa.com';
    }

    // Ensure it starts with https:// if it's a non-localhost URL, or return as is if already a valid URL
    if (envApplicationUrl.startsWith('http://localhost') || envApplicationUrl.startsWith('https://')) {
        return envApplicationUrl;
    } else {
        return `https://${envApplicationUrl}`;
    }
  }

  private mapRowToConfig(row: any): EmailProviderConfig {
    const baseUrl = this.getBaseUrl();
    const webhookPath = row.provider_type === 'microsoft'
      ? '/api/email/webhooks/microsoft'
      : '/api/email/webhooks/google';

    return {
      id: row.id,
      tenant: row.tenant,
      name: row.provider_name,
      provider_type: row.provider_type || 'microsoft',
      mailbox: row.mailbox,
      folder_to_monitor: 'Inbox', // Default
      active: row.is_active,
      webhook_notification_url: `${baseUrl}${webhookPath}`,
      webhook_subscription_id: row.webhook_subscription_id,
      webhook_verification_token: row.webhook_verification_token,
      webhook_expires_at: row.webhook_expires_at,
      last_subscription_renewal: row.last_subscription_renewal,
      connection_status: row.status || 'connected',
      last_connection_test: row.last_sync_at,
      connection_error_message: row.error_message,
      created_at: row.created_at,
      updated_at: row.updated_at,
      provider_config: {
        client_id: row.client_id,
        client_secret: row.client_secret,
        tenantId: row.tenant_id,
        access_token: row.access_token,
        refresh_token: row.refresh_token,
        token_expires_at: row.token_expires_at,
      }
    };
  }
}