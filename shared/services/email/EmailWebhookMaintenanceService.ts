import { getAdminConnection } from '../../db/admin';
import { tenantDb } from '@alga-psa/db';
import { EmailProviderConfig } from '../../interfaces/inbound-email.interfaces';
import { MicrosoftGraphAdapter } from './providers/MicrosoftGraphAdapter';
import logger from '../../core/logger';
import { buildMicrosoftEmailProviderConfig } from './microsoftEmailProviderConfig';
import { enqueueUnifiedInboundEmailQueueJob } from './unifiedInboundEmailQueue';

const PROVIDER_TENANT_DISCOVERY = 'tenant-discovery';

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

interface ReconciliationResult {
  queuedMessages: number;
  switchedToPolling: boolean;
}

const TOKEN_REFRESH_LOOK_AHEAD_MINUTES = 30;
const RECONCILE_WINDOW_CAP_MS = 7 * 24 * 60 * 60 * 1000;
const RECONCILE_SAFETY_MARGIN_MS = 15 * 60 * 1000;
const DEFAULT_RECONCILE_MAX_MESSAGES = 50;
const WEBHOOK_SILENT_RUN_THRESHOLD = 3;
const SUBSCRIPTION_PROBE_INTERVAL_MS = 24 * 60 * 60 * 1000;

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
      const candidates = await this.findActiveMicrosoftProviders(tenantId, providerId);
      logger.info(`Found ${candidates.length} active Microsoft email providers`);

      const results: RenewalResult[] = [];

      for (const candidate of candidates) {
        try {
          const result = await this.processCandidate(candidate, lookAheadMinutes, Boolean(providerId));
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

  /** Reconcile only providers explicitly operating without webhooks. */
  async reconcilePollingProviders(options: Pick<RenewalOptions, 'tenantId' | 'providerId'> = {}): Promise<RenewalResult[]> {
    const candidates = await this.findActiveMicrosoftProviders(
      options.tenantId,
      options.providerId,
      'polling'
    );
    const results: RenewalResult[] = [];

    for (const candidate of candidates) {
      try {
        const resolvedConfig = await buildMicrosoftEmailProviderConfig(candidate);
        const adapter = new MicrosoftGraphAdapter(resolvedConfig);
        await adapter.ensureTokenHealthy(TOKEN_REFRESH_LOOK_AHEAD_MINUTES);
        await this.updateProviderConnectionStatus(candidate.id, candidate.tenant, 'connected', null);
        await this.reconcileMissedMessages(adapter, resolvedConfig, false);
        results.push({
          providerId: candidate.id,
          tenant: candidate.tenant,
          success: true,
          action: 'skipped',
        });
      } catch (error: any) {
        const message = error?.message || 'Microsoft polling reconciliation failed';
        await this.updateProviderConnectionStatus(candidate.id, candidate.tenant, 'error', message);
        logger.error('Microsoft polling reconciliation failed', {
          providerId: candidate.id,
          tenant: candidate.tenant,
          error: message,
        });
        results.push({
          providerId: candidate.id,
          tenant: candidate.tenant,
          success: false,
          action: 'failed',
          error: message,
        });
      }
    }

    return results;
  }

  async usePollingDelivery(params: {
    providerId: string;
    tenant: string;
    reason: string;
    probeFailure?: boolean;
  }): Promise<string> {
    const knex = await getAdminConnection();
    const nextProbeAt = new Date(Date.now() + SUBSCRIPTION_PROBE_INTERVAL_MS).toISOString();
    await tenantDb(knex, params.tenant).table('microsoft_email_provider_config')
      .where({ email_provider_id: params.providerId })
      .update({
        delivery_mode: 'polling',
        webhook_subscription_id: null,
        webhook_expires_at: null,
        webhook_silent_runs: 0,
        next_subscription_probe_at: nextProbeAt,
        updated_at: new Date().toISOString(),
      });
    await this.updateProviderConnectionStatus(params.providerId, params.tenant, 'connected', null);
    await this.updateHealthStatus(params.providerId, params.tenant, {
      subscription_status: 'polling',
      last_renewal_result: params.probeFailure ? 'probe_validation_failed' : 'polling_enabled',
      failure_reason: params.reason,
      is_healthy: true,
    });
    logger.info('Microsoft email delivery mode is polling', {
      providerId: params.providerId,
      tenant: params.tenant,
      reason: params.reason,
      nextProbeAt,
    });
    return nextProbeAt;
  }

  async recordWebhookDeliveryMode(params: {
    providerId: string;
    tenant: string;
    reason: string;
  }): Promise<void> {
    const knex = await getAdminConnection();
    await tenantDb(knex, params.tenant).table('microsoft_email_provider_config')
      .where({ email_provider_id: params.providerId })
      .update({
        delivery_mode: 'webhook',
        webhook_silent_runs: 0,
        next_subscription_probe_at: null,
        updated_at: new Date().toISOString(),
      });
    await this.updateProviderConnectionStatus(params.providerId, params.tenant, 'connected', null);
    await this.updateHealthStatus(params.providerId, params.tenant, {
      subscription_status: 'healthy',
      last_renewal_result: 'webhook_enabled',
      failure_reason: null,
      is_healthy: true,
    });
    logger.info('Microsoft email delivery mode changed to webhook', params);
  }

  /**
   * Find providers that need renewal
   */
  private async findActiveMicrosoftProviders(
    tenantId?: string,
    providerId?: string,
    deliveryMode?: 'webhook' | 'polling'
  ): Promise<EmailProviderConfig[]> {
    const knex = await getAdminConnection();

    const providerRoot = tenantId
      ? tenantDb(knex, tenantId).table('email_providers as ep')
      : tenantDb(knex, PROVIDER_TENANT_DISCOVERY).unscoped(
          'email_providers as ep',
          'cross-tenant Microsoft email webhook renewal candidate discovery'
        );

    let query = providerRoot;
    if (tenantId) {
      tenantDb(knex, tenantId).tenantJoin(
        query,
        'microsoft_email_provider_config as mpc',
        'ep.id',
        'mpc.email_provider_id',
        {
          rootTenantColumn: 'ep.tenant',
        }
      );
    } else {
      query = tenantDb(knex, PROVIDER_TENANT_DISCOVERY).tenantJoin(
        query,
        'microsoft_email_provider_config as mpc',
        'ep.id',
        'mpc.email_provider_id',
        { rootTenantColumn: 'ep.tenant' }
      );
    }
    query = query
      .where('ep.provider_type', 'microsoft')
      .andWhere('ep.is_active', true);

    if (providerId) {
      query = query.andWhere('ep.id', providerId);
    }
    if (deliveryMode) {
      query = query.andWhere('mpc.delivery_mode', deliveryMode);
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
      'mpc.delivery_mode',
      'mpc.last_webhook_delivery_at',
      'mpc.webhook_silent_runs',
      'mpc.next_subscription_probe_at',
      // Select all vendor config columns as an object if possible, or spread them
      // For simplicity, we'll select the raw columns and map them manually as needed by the adapter
      'mpc.client_id',
      'mpc.client_secret',
      'mpc.tenant_id',
      'mpc.access_token',
      'mpc.refresh_token',
      'mpc.token_expires_at',
      'mpc.folder_filters',
      'mpc.max_emails_per_sync',
      'mpc.microsoft_profile_id',
      'mpc.client_secret_ref'
    );

    return rows.map(row => this.mapRowToConfig(row));
  }

  /**
   * Process a single renewal candidate
   */
  private async processCandidate(
    config: EmailProviderConfig,
    lookAheadMinutes: number,
    forceRenewal: boolean
  ): Promise<RenewalResult> {
    logger.info(`Processing renewal for ${config.name} (${config.id})`, { 
      tenant: config.tenant,
      currentExpiry: config.webhook_expires_at 
    });

    try {
      const resolvedConfig = await buildMicrosoftEmailProviderConfig(config);
      const adapter = new MicrosoftGraphAdapter(resolvedConfig);

      try {
        await adapter.ensureTokenHealthy(TOKEN_REFRESH_LOOK_AHEAD_MINUTES);
        await this.updateProviderConnectionStatus(config.id, config.tenant, 'connected', null);
      } catch (error: any) {
        const message = error?.message || 'Microsoft token refresh failed';
        await this.updateProviderConnectionStatus(config.id, config.tenant, 'error', message);
        await this.updateHealthStatus(config.id, config.tenant, {
          subscription_status: 'error',
          last_renewal_result: 'failure',
          failure_reason: message,
          is_healthy: false,
        });
        throw error;
      }

      const deliveryMode = config.delivery_mode ||
        (config.webhook_subscription_id ? 'webhook' : 'polling');
      if (deliveryMode === 'polling') {
        const probeAt = config.next_subscription_probe_at
          ? new Date(config.next_subscription_probe_at).getTime()
          : 0;
        if (forceRenewal || probeAt <= Date.now()) {
          return await this.probeSubscription(adapter, config);
        }
        return {
          providerId: config.id,
          tenant: config.tenant,
          success: true,
          action: 'skipped',
        };
      }

      await adapter.cleanupOrphanedSubscriptions();
      const reconciliation = await this.reconcileMissedMessages(adapter, resolvedConfig, true);
      if (reconciliation.switchedToPolling) {
        return {
          providerId: config.id,
          tenant: config.tenant,
          success: true,
          action: 'skipped',
        };
      }

      const expiryMs = config.webhook_expires_at
        ? new Date(config.webhook_expires_at).getTime()
        : 0;
      const renewalDue = forceRenewal || !config.webhook_subscription_id ||
        expiryMs <= Date.now() + lookAheadMinutes * 60 * 1000;
      if (!renewalDue) {
        return {
          providerId: config.id,
          tenant: config.tenant,
          success: true,
          action: 'skipped',
          newExpiration: config.webhook_expires_at,
        };
      }

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
          failure_reason: null,
          is_healthy: true,
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
      await this.updateProviderConnectionStatus(
        config.id,
        config.tenant,
        'error',
        error?.message || 'Microsoft email maintenance failed'
      );
      
      await this.updateHealthStatus(config.id, config.tenant, {
        subscription_status: 'error',
        last_renewal_result: 'failure',
        failure_reason: error.message,
        is_healthy: false,
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

    // Validate URL before attempting registration
    if (config.webhook_notification_url.includes('localhost') || !config.webhook_notification_url.startsWith('https://')) {
      const msg = `Invalid webhook URL detected: ${config.webhook_notification_url}. Microsoft requires a public HTTPS endpoint. Check APPLICATION_URL env var.`;
      logger.error(msg, { providerId: config.id, tenant: config.tenant });
      return this.enterPollingMode(config, msg);
    }

    logger.info(`Attempting to recreate subscription with URL: ${config.webhook_notification_url}`, { 
      providerId: config.id, 
      tenant: config.tenant 
    });

    const result = await adapter.initializeWebhook(config.webhook_notification_url);
    
    if (!result.success) {
      if (result.errorKind === 'validation') {
        return this.enterPollingMode(config, result.error || 'Microsoft webhook endpoint validation failed');
      }
      throw new Error(result.error || 'Failed to initialize webhook');
    }

    await this.updateHealthStatus(config.id, config.tenant, {
      subscription_status: 'healthy',
      last_renewal_result: 'success',
      failure_reason: null,
      is_healthy: true,
    });

    return {
      providerId: config.id,
      tenant: config.tenant,
      success: true,
      action: 'recreated',
      newExpiration: adapter.getConfig().webhook_expires_at
    };
  }

  private async probeSubscription(
    adapter: MicrosoftGraphAdapter,
    config: EmailProviderConfig
  ): Promise<RenewalResult> {
    if (!config.webhook_notification_url ||
        config.webhook_notification_url.includes('localhost') ||
        !config.webhook_notification_url.startsWith('https://')) {
      return this.enterPollingMode(
        config,
        'Microsoft webhook endpoint is not a public HTTPS URL',
        true
      );
    }

    const result = await adapter.initializeWebhook(config.webhook_notification_url);
    if (result.success) {
      await this.recordWebhookDeliveryMode({
        providerId: config.id,
        tenant: config.tenant,
        reason: 'subscription probe succeeded',
      });
      return {
        providerId: config.id,
        tenant: config.tenant,
        success: true,
        action: 'recreated',
        newExpiration: adapter.getConfig().webhook_expires_at,
      };
    }

    if (result.errorKind === 'validation') {
      return this.enterPollingMode(
        config,
        result.error || 'Microsoft webhook endpoint validation failed',
        true
      );
    }
    throw new Error(result.error || 'Microsoft subscription recovery probe failed');
  }

  private async enterPollingMode(
    config: EmailProviderConfig,
    reason: string,
    probeFailure = false
  ): Promise<RenewalResult> {
    await this.usePollingDelivery({
      providerId: config.id,
      tenant: config.tenant,
      reason,
      probeFailure,
    });
    return {
      providerId: config.id,
      tenant: config.tenant,
      success: true,
      action: 'skipped',
    };
  }

  private async reconcileMissedMessages(
    adapter: MicrosoftGraphAdapter,
    config: EmailProviderConfig,
    detectWebhookSilence: boolean
  ): Promise<ReconciliationResult> {
    const knex = await getAdminConnection();
    const db = tenantDb(knex, config.tenant);
    const provider = await db.table('email_providers')
      .where({ id: config.id })
      .first('last_sync_at');
    const lastSyncMs = provider?.last_sync_at
      ? new Date(provider.last_sync_at).getTime() - RECONCILE_SAFETY_MARGIN_MS
      : Date.now() - RECONCILE_WINDOW_CAP_MS;
    const since = new Date(Math.max(lastSyncMs, Date.now() - RECONCILE_WINDOW_CAP_MS));
    const maxCount = Math.max(
      1,
      Number(config.provider_config?.max_emails_per_sync || DEFAULT_RECONCILE_MAX_MESSAGES)
    );
    const messages = await adapter.listMessagesReceivedSince(since, maxCount);
    let queuedMessages = 0;

    if (messages.length > 0) {
      const processedRows = await db.table('email_processed_messages')
        .where({ provider_id: config.id })
        .whereIn('message_id', messages.map((message) => message.id))
        .select('message_id');
      const processed = new Set(processedRows.map((row: any) => String(row.message_id)));
      for (const message of messages) {
        if (processed.has(message.id)) continue;
        await enqueueUnifiedInboundEmailQueueJob({
          tenantId: config.tenant,
          providerId: config.id,
          provider: 'microsoft',
          pointer: {
            subscriptionId: config.webhook_subscription_id || 'reconcile',
            messageId: message.id,
            resource: 'maintenance-reconcile',
            changeType: 'created',
          },
        });
        queuedMessages += 1;
      }
    }

    const completedAt = new Date().toISOString();
    await db.table('email_providers').where({ id: config.id }).update({
      last_sync_at: completedAt,
      updated_at: completedAt,
    });

    if (!detectWebhookSilence || queuedMessages === 0) {
      return { queuedMessages, switchedToPolling: false };
    }

    const latestMicrosoftConfig = await db.table('microsoft_email_provider_config')
      .where({ email_provider_id: config.id })
      .first('last_webhook_delivery_at', 'webhook_silent_runs');
    const previousSyncAt = provider?.last_sync_at ? new Date(provider.last_sync_at).getTime() : 0;
    const webhookDeliveryAt = latestMicrosoftConfig?.last_webhook_delivery_at
      ? new Date(latestMicrosoftConfig.last_webhook_delivery_at).getTime()
      : 0;
    if (webhookDeliveryAt > previousSyncAt) {
      await db.table('microsoft_email_provider_config')
        .where({ email_provider_id: config.id })
        .update({ webhook_silent_runs: 0, updated_at: completedAt });
      return { queuedMessages, switchedToPolling: false };
    }

    const silentRuns = Number(latestMicrosoftConfig?.webhook_silent_runs || 0) + 1;
    await db.table('microsoft_email_provider_config')
      .where({ email_provider_id: config.id })
      .update({ webhook_silent_runs: silentRuns, updated_at: completedAt });
    if (silentRuns < WEBHOOK_SILENT_RUN_THRESHOLD) {
      return { queuedMessages, switchedToPolling: false };
    }

    await adapter.deleteWebhookSubscription();
    const reason = `${silentRuns} reconciliation runs imported messages without a webhook delivery`;
    await this.enterPollingMode(config, reason);
    return { queuedMessages, switchedToPolling: true };
  }

  private async updateProviderConnectionStatus(
    providerId: string,
    tenant: string,
    status: 'connected' | 'error',
    errorMessage: string | null
  ): Promise<void> {
    const knex = await getAdminConnection();
    await tenantDb(knex, tenant).table('email_providers')
      .where({ id: providerId })
      .update({
        status,
        error_message: errorMessage,
        updated_at: new Date().toISOString(),
      });
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
    is_healthy?: boolean;
  }): Promise<void> {
    try {
      const knex = await getAdminConnection();
      const scopedDb = tenantDb(knex, tenant);
      const now = new Date().toISOString();
      
      // Check if health row exists, if not create it
      const existing = await scopedDb.table('email_provider_health')
        .where('provider_id', providerId)
        .first();

      if (existing) {
        await scopedDb.table('email_provider_health')
          .where('provider_id', providerId)
          .update({
            ...status,
            last_renewal_attempt_at: now,
            updated_at: now
          });
      } else {
        await scopedDb.table('email_provider_health')
          .insert({
            provider_id: providerId,
            tenant: tenant, // Fixed: column name is 'tenant', not 'tenant_id'
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
      delivery_mode: row.delivery_mode,
      last_webhook_delivery_at: row.last_webhook_delivery_at,
      webhook_silent_runs: row.webhook_silent_runs,
      next_subscription_probe_at: row.next_subscription_probe_at,
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
        folder_filters: row.folder_filters,
        max_emails_per_sync: row.max_emails_per_sync,
        microsoft_profile_id: row.microsoft_profile_id,
        client_secret_ref: row.client_secret_ref,
      }
    };
  }
}
