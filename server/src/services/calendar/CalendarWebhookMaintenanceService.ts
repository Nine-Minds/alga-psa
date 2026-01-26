import { getAdminConnection } from '@alga-psa/db';
import { CalendarProviderConfig } from '@/interfaces/calendar.interfaces';
import { MicrosoftCalendarAdapter } from './providers/MicrosoftCalendarAdapter';
import logger from '@alga-psa/core/logger';
import { CalendarProviderService } from './CalendarProviderService';

// PostHog analytics (EE only)
let analytics: any = null;
if (process.env.EDITION === 'enterprise') {
  try {
    analytics = require('../../lib/analytics/posthog').getAnalytics();
  } catch (error) {
    // Analytics not available, continue without it
  }
}

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

export class CalendarWebhookMaintenanceService {
  
  constructor() {
    // No setup needed for logger
  }

  /**
   * Main entry point to renew Microsoft webhook subscriptions
   */
  async renewMicrosoftWebhooks(options: RenewalOptions = {}): Promise<RenewalResult[]> {
    const { tenantId, providerId, lookAheadMinutes = 180 } = options;
    logger.info('Starting Microsoft calendar webhook renewal check', { tenantId, providerId, lookAheadMinutes });

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
      logger.error('Failed to execute calendar webhook renewal cycle', error);
      throw error;
    }
  }

  /**
   * Find providers that need renewal
   */
  private async findRenewalCandidates(lookAheadMinutes: number, tenantId?: string, providerId?: string): Promise<CalendarProviderConfig[]> {
    const knex = await getAdminConnection();
    const now = new Date();
    const threshold = new Date(now.getTime() + lookAheadMinutes * 60000);

    let query = knex('calendar_providers as cp')
      .join('microsoft_calendar_provider_config as mcp', function() {
        this.on('cp.id', '=', 'mcp.calendar_provider_id')
          .andOn('cp.tenant', '=', 'mcp.tenant');
      })
      .where('cp.provider_type', 'microsoft')
      .andWhere('cp.is_active', true);

    // If providerId is specified, we ignore expiration/missing subscription logic and force check/renew
    if (!providerId) {
      query = query.andWhere(function() {
        this.whereNull('mcp.webhook_expires_at')
          .orWhere('mcp.webhook_expires_at', '<=', threshold.toISOString())
          .orWhereNull('mcp.webhook_subscription_id');
      });
    }

    if (tenantId) {
      query = query.andWhere('cp.tenant', tenantId);
    }

    if (providerId) {
      query = query.andWhere('cp.id', providerId);
    }

    // Select all columns needed to construct CalendarProviderConfig
    const rows = await query.select(
      'cp.id',
      'cp.tenant',
      'cp.provider_name',
      'cp.provider_type',
      'cp.calendar_id',
      'cp.is_active',
      'cp.status',
      'cp.sync_direction',
      'cp.last_sync_at',
      'cp.error_message',
      'cp.created_at',
      'cp.updated_at',
      'mcp.webhook_subscription_id',
      'mcp.webhook_verification_token',
      'mcp.webhook_expires_at',
      'mcp.webhook_notification_url',
      'mcp.client_id',
      'mcp.client_secret',
      'mcp.tenant_id',
      'mcp.redirect_uri',
      'mcp.access_token',
      'mcp.refresh_token',
      'mcp.token_expires_at',
      'mcp.calendar_id as vendor_calendar_id'
    );

    // Use CalendarProviderService to properly hydrate the config with decryption
    const providerService = new CalendarProviderService();
    const hydratedConfigs: CalendarProviderConfig[] = [];

    for (const row of rows) {
      try {
        const fullProvider = await providerService.getProvider(row.id, row.tenant, {
          includeSecrets: true
        });
        if (fullProvider) {
          hydratedConfigs.push(fullProvider);
        }
      } catch (error: any) {
        logger.warn(`Failed to hydrate provider ${row.id}, skipping`, { error: error.message });
      }
    }

    return hydratedConfigs;
  }

  /**
   * Process a single renewal candidate
   */
  private async processCandidate(config: CalendarProviderConfig): Promise<RenewalResult> {
    logger.info(`Processing renewal for ${config.name} (${config.id})`, { 
      tenant: config.tenant,
      currentExpiry: config.provider_config?.webhookExpiresAt 
    });

    const adapter = new MicrosoftCalendarAdapter(config);

    try {
      // Case 1: No subscription ID -> Register new
      if (!config.provider_config?.webhookSubscriptionId) {
        logger.info(`No subscription ID for ${config.id}, registering new webhook`);
        return await this.recreateSubscription(adapter, config);
      }

      // Case 2: Has subscription ID -> Try to renew
      try {
        await adapter.renewWebhookSubscription();
        
        // Get updated expiry from adapter's config
        const updatedConfig = await this.getUpdatedProviderConfig(config.id, config.tenant);
        const newExpiration = updatedConfig?.provider_config?.webhookExpiresAt;

        // Update health status on success
        await this.updateHealthStatus(config.id, config.tenant, {
          subscription_status: 'healthy',
          subscription_expires_at: newExpiration ? new Date(newExpiration) : null,
          last_renewal_result: 'success',
          failure_reason: null,
          consecutive_failure_count: 0
        });

        // Update provider status on success
        await this.updateProviderStatus(config.id, config.tenant, {
          status: 'connected',
          errorMessage: null
        });

        // Emit PostHog event (EE only)
        if (analytics) {
          analytics.capture('calendar_provider.subscription_renewal_success', {
            provider_id: config.id,
            tenant: config.tenant,
            provider_type: 'microsoft',
            action: 'renewed',
            expires_at: newExpiration
          }).catch((err: any) => {
            logger.warn('Failed to emit PostHog event', { error: err.message });
          });
        }

        return {
          providerId: config.id,
          tenant: config.tenant,
          success: true,
          action: 'renewed',
          newExpiration
        };
      } catch (error: any) {
        // Check for 404 ResourceNotFound
        if (this.isResourceNotFoundError(error)) {
          logger.warn(`Subscription not found (404) for ${config.id}, attempting to recreate`);
          return await this.recreateSubscription(adapter, config);
        }
        
        throw error;
      }
    } catch (error: any) {
      logger.error(`Failed to renew/recreate subscription for ${config.id}`, error);
      
      // Get current failure count
      const health = await this.getHealthStatus(config.id, config.tenant);
      const consecutiveFailures = (health?.consecutive_failure_count || 0) + 1;
      
      // Update health status on failure
      await this.updateHealthStatus(config.id, config.tenant, {
        subscription_status: 'error',
        last_renewal_result: 'failure',
        failure_reason: error.message,
        consecutive_failure_count: consecutiveFailures
      });

      // Mark provider as error after 3+ consecutive failures
      if (consecutiveFailures >= 3) {
        await this.updateProviderStatus(config.id, config.tenant, {
          status: 'error',
          errorMessage: `Webhook renewal failed ${consecutiveFailures} times: ${error.message}`
        });
      }

      // Emit PostHog event (EE only)
      if (analytics) {
        analytics.capture('calendar_provider.subscription_renewal_failure', {
          provider_id: config.id,
          tenant: config.tenant,
          provider_type: 'microsoft',
          action: 'failed',
          error: error.message,
          consecutive_failures: consecutiveFailures,
          threshold_exceeded: consecutiveFailures >= 3
        }).catch((err: any) => {
          logger.warn('Failed to emit PostHog event', { error: err.message });
        });
      }

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
   * The adapter handles webhook URL derivation from config or environment variables
   */
  private async recreateSubscription(adapter: MicrosoftCalendarAdapter, config: CalendarProviderConfig): Promise<RenewalResult> {
    logger.info(`Attempting to recreate subscription for provider ${config.id}`, { 
      providerId: config.id, 
      tenant: config.tenant 
    });

    try {
      await adapter.registerWebhookSubscription();
      
      // Get updated expiry from adapter's config
      const updatedConfig = await this.getUpdatedProviderConfig(config.id, config.tenant);
      const newExpiration = updatedConfig?.provider_config?.webhookExpiresAt;

      // Update health status on success
      await this.updateHealthStatus(config.id, config.tenant, {
        subscription_status: 'healthy',
        subscription_expires_at: newExpiration ? new Date(newExpiration) : null,
        last_renewal_result: 'success',
        failure_reason: null,
        consecutive_failure_count: 0
      });

      // Update provider status on success
      await this.updateProviderStatus(config.id, config.tenant, {
        status: 'connected',
        errorMessage: null
      });

      // Emit PostHog event (EE only)
      if (analytics) {
        analytics.capture('calendar_provider.subscription_renewal_success', {
          provider_id: config.id,
          tenant: config.tenant,
          provider_type: 'microsoft',
          action: 'recreated',
          expires_at: newExpiration
        }).catch((err: any) => {
          logger.warn('Failed to emit PostHog event', { error: err.message });
        });
      }

      return {
        providerId: config.id,
        tenant: config.tenant,
        success: true,
        action: 'recreated',
        newExpiration
      };
    } catch (error: any) {
      logger.error(`Failed to recreate subscription for ${config.id}`, error);
      throw error;
    }
  }

  /**
   * Check if error is a 404 ResourceNotFound error
   */
  private isResourceNotFoundError(error: any): boolean {
    // Check for Graph API 404 structure
    if (error?.response?.status === 404) return true;
    if (error?.code === 'ResourceNotFound') return true;
    if (error?.message?.includes('ResourceNotFound')) return true;
    if (error?.message?.includes('Subscription not found')) return true;
    if (error?.message?.includes('404')) return true;
    return false;
  }

  /**
   * Update provider status in calendar_providers table
   */
  private async updateProviderStatus(providerId: string, tenant: string, status: {
    status?: 'connected' | 'disconnected' | 'error' | 'configuring';
    errorMessage?: string | null;
  }): Promise<void> {
    try {
      const knex = await getAdminConnection();
      const updateData: any = {
        updated_at: knex.fn.now()
      };

      if (status.status !== undefined) {
        updateData.status = status.status;
      }

      if (status.errorMessage !== undefined) {
        updateData.error_message = status.errorMessage;
      }

      await knex('calendar_providers')
        .where('id', providerId)
        .andWhere('tenant', tenant)
        .update(updateData);
    } catch (error) {
      logger.warn(`Failed to update provider status for ${providerId}`, error);
    }
  }

  /**
   * Get updated provider config after renewal/recreation
   */
  private async getUpdatedProviderConfig(providerId: string, tenant: string): Promise<CalendarProviderConfig | null> {
    try {
      const providerService = new CalendarProviderService();
      return await providerService.getProvider(providerId, tenant, {
        includeSecrets: false
      });
    } catch (error) {
      logger.warn(`Failed to get updated provider config for ${providerId}`, error);
      return null;
    }
  }

  /**
   * Update health status in calendar_provider_health table
   */
  private async updateHealthStatus(providerId: string, tenant: string, status: {
    subscription_status?: string;
    subscription_expires_at?: Date | null;
    last_renewal_result?: string;
    failure_reason?: string | null;
    consecutive_failure_count?: number;
  }): Promise<void> {
    try {
      const knex = await getAdminConnection();
      const now = new Date().toISOString();
      
      // Check if health row exists, if not create it
      const existing = await knex('calendar_provider_health')
        .where('calendar_provider_id', providerId)
        .andWhere('tenant', tenant)
        .first();

      const updateData: any = {
        updated_at: now
      };

      if (status.subscription_status !== undefined) {
        updateData.subscription_status = status.subscription_status;
      }
      if (status.subscription_expires_at !== undefined) {
        updateData.subscription_expires_at = status.subscription_expires_at ? status.subscription_expires_at.toISOString() : null;
      }
      if (status.last_renewal_result !== undefined) {
        updateData.last_renewal_result = status.last_renewal_result;
        updateData.last_renewal_attempt_at = now;
      }
      if (status.failure_reason !== undefined) {
        updateData.failure_reason = status.failure_reason;
      }
      if (status.consecutive_failure_count !== undefined) {
        updateData.consecutive_failure_count = status.consecutive_failure_count;
      }

      if (existing) {
        await knex('calendar_provider_health')
          .where('calendar_provider_id', providerId)
          .andWhere('tenant', tenant)
          .update(updateData);
      } else {
        await knex('calendar_provider_health')
          .insert({
            calendar_provider_id: providerId,
            tenant: tenant,
            ...updateData,
            created_at: now
          });
      }
    } catch (error) {
      logger.warn(`Failed to update health status for ${providerId}`, error);
    }
  }

  /**
   * Get current health status for a provider
   */
  private async getHealthStatus(providerId: string, tenant: string): Promise<{
    consecutive_failure_count?: number;
    subscription_status?: string;
  } | null> {
    try {
      const knex = await getAdminConnection();
      const health = await knex('calendar_provider_health')
        .where('calendar_provider_id', providerId)
        .andWhere('tenant', tenant)
        .first();
      return health || null;
    } catch (error) {
      logger.warn(`Failed to get health status for ${providerId}`, error);
      return null;
    }
  }
}

