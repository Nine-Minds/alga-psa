import { tenantDb } from '@alga-psa/db';
import { getAdminConnection } from '@alga-psa/db/admin';
import type { EmailProviderConfig } from '../../interfaces/inbound-email.interfaces';
import { EmailWebhookMaintenanceService } from './EmailWebhookMaintenanceService';
import { buildMicrosoftEmailProviderConfig } from './microsoftEmailProviderConfig';
import { GmailAdapter } from './providers/GmailAdapter';
import { MicrosoftGraphAdapter } from './providers/MicrosoftGraphAdapter';
import { getEmailWebhookBaseUrl } from './webhookBaseUrl';

export type InboundPauseReason = 'manual' | 'tenant_cancelled';

export interface ResumeProviderResult {
  resumed: boolean;
  webhookRegistered: boolean;
  error?: string;
}

type ProviderRecord = {
  id: string;
  tenant: string;
  provider_type: 'microsoft' | 'google' | 'imap';
  provider_name: string;
  mailbox: string;
  is_active: boolean;
  status: EmailProviderConfig['connection_status'];
  inbound_paused_at?: string | Date | null;
  inbound_pause_reason?: InboundPauseReason | null;
  created_at: string;
  updated_at: string;
};

export class EmailProviderLifecycleService {
  private async loadProvider(providerId: string, tenant: string): Promise<{
    provider: ProviderRecord;
    vendorConfig: any;
  } | null> {
    const knex = await getAdminConnection();
    const db = tenantDb(knex, tenant);
    const provider = await db.table('email_providers')
      .where({ id: providerId })
      .first() as ProviderRecord | undefined;
    if (!provider) return null;

    const configTable = provider.provider_type === 'microsoft'
      ? 'microsoft_email_provider_config'
      : provider.provider_type === 'google'
        ? 'google_email_provider_config'
        : 'imap_email_provider_config';
    const vendorConfig = await db.table(configTable)
      .where({ email_provider_id: providerId })
      .first();
    return { provider, vendorConfig: vendorConfig || {} };
  }

  private toAdapterConfig(provider: ProviderRecord, vendorConfig: any): EmailProviderConfig {
    const baseUrl = getEmailWebhookBaseUrl();
    const webhookPath = provider.provider_type === 'microsoft'
      ? '/api/email/webhooks/microsoft'
      : provider.provider_type === 'google'
        ? '/api/email/webhooks/google'
        : '/api/email/webhooks/imap';

    return {
      id: provider.id,
      tenant: provider.tenant,
      name: provider.provider_name,
      provider_type: provider.provider_type,
      mailbox: provider.mailbox,
      folder_to_monitor: 'Inbox',
      active: provider.is_active,
      inboundPausedAt: provider.inbound_paused_at
        ? new Date(provider.inbound_paused_at).toISOString()
        : null,
      inboundPauseReason: provider.inbound_pause_reason || null,
      webhook_notification_url: `${baseUrl}${webhookPath}`,
      webhook_subscription_id: vendorConfig.webhook_subscription_id || undefined,
      webhook_verification_token: vendorConfig.webhook_verification_token || undefined,
      webhook_expires_at: vendorConfig.webhook_expires_at || undefined,
      delivery_mode: vendorConfig.delivery_mode || undefined,
      connection_status: provider.status || 'connected',
      connection_error_message: undefined,
      provider_config: vendorConfig,
      created_at: provider.created_at,
      updated_at: provider.updated_at,
    };
  }

  /**
   * Tear down external notification sources and clear local renewal cursors.
   * Failures are deliberately contained because the database ingestion gate is
   * authoritative and remote subscriptions expire naturally.
   */
  async teardownProviderSubscriptions(providerId: string, tenant: string): Promise<void> {
    const loaded = await this.loadProvider(providerId, tenant);
    if (!loaded) return;
    const { provider, vendorConfig } = loaded;
    const knex = await getAdminConnection();
    const db = tenantDb(knex, tenant);

    try {
      const adapterConfig = this.toAdapterConfig(provider, vendorConfig);
      if (provider.provider_type === 'microsoft' && vendorConfig.webhook_subscription_id) {
        const adapter = new MicrosoftGraphAdapter(
          await buildMicrosoftEmailProviderConfig(adapterConfig)
        );
        await adapter.deleteSubscription(vendorConfig.webhook_subscription_id);
      } else if (provider.provider_type === 'google') {
        await new GmailAdapter(adapterConfig).stopWatch();
      }
    } catch (error) {
      console.warn('[EmailProviderLifecycle] external subscription teardown failed', {
        tenant,
        providerId,
        providerType: provider.provider_type,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (provider.provider_type === 'microsoft') {
        await db.table('microsoft_email_provider_config')
          .where({ email_provider_id: providerId })
          .update({
            webhook_subscription_id: null,
            webhook_expires_at: null,
            updated_at: knex.fn.now(),
          });
      } else if (provider.provider_type === 'google') {
        await db.table('google_email_provider_config')
          .where({ email_provider_id: providerId })
          .update({
            watch_expiration: null,
            updated_at: knex.fn.now(),
          });
      }
    }
  }

  async pauseProvider(
    providerId: string,
    tenant: string,
    reason: InboundPauseReason
  ): Promise<boolean> {
    const knex = await getAdminConnection();
    const db = tenantDb(knex, tenant);
    const updated = await db.table('email_providers')
      .where({ id: providerId })
      .whereNull('inbound_paused_at')
      .update({
        inbound_paused_at: knex.fn.now(),
        inbound_pause_reason: reason,
        updated_at: knex.fn.now(),
      });

    if (Number(updated) === 0) {
      const exists = await db.table('email_providers').where({ id: providerId }).first('id');
      if (!exists) throw new Error('Provider not found');
      return false;
    }

    await this.teardownProviderSubscriptions(providerId, tenant);
    return true;
  }

  async resumeProvider(providerId: string, tenant: string): Promise<ResumeProviderResult> {
    const knex = await getAdminConnection();
    const db = tenantDb(knex, tenant);
    const updated = await db.table('email_providers')
      .where({ id: providerId })
      .whereNotNull('inbound_paused_at')
      .update({
        inbound_paused_at: null,
        inbound_pause_reason: null,
        updated_at: knex.fn.now(),
      });
    if (Number(updated) === 0) {
      const exists = await db.table('email_providers').where({ id: providerId }).first('id');
      if (!exists) throw new Error('Provider not found');
      return { resumed: false, webhookRegistered: false };
    }

    const loaded = await this.loadProvider(providerId, tenant);
    if (!loaded) throw new Error('Provider not found');
    const { provider, vendorConfig } = loaded;
    const shouldRegister = provider.is_active && (
      provider.provider_type === 'google'
      || (provider.provider_type === 'microsoft' && vendorConfig.delivery_mode === 'webhook')
    );
    if (!shouldRegister) {
      return { resumed: true, webhookRegistered: false };
    }

    try {
      const adapterConfig = this.toAdapterConfig(provider, vendorConfig);
      if (provider.provider_type === 'microsoft') {
        const adapter = new MicrosoftGraphAdapter(
          await buildMicrosoftEmailProviderConfig(adapterConfig)
        );
        const result = await adapter.initializeWebhook(adapterConfig.webhook_notification_url);
        if (!result.success && result.errorKind === 'validation') {
          // Same degradation as initializeProviderWebhook: an unreachable
          // endpoint means polling, not a dead provider.
          await new EmailWebhookMaintenanceService().usePollingDelivery({
            providerId,
            tenant,
            reason: result.error || 'Microsoft webhook endpoint validation failed on resume',
          });
          await db.table('email_providers').where({ id: providerId }).update({
            status: 'connected',
            error_message: null,
            updated_at: knex.fn.now(),
          });
          return { resumed: true, webhookRegistered: false };
        }
        if (!result.success) throw new Error(result.error || 'Microsoft webhook registration failed');
        await db.table('microsoft_email_provider_config')
          .where({ email_provider_id: providerId })
          .update({
            webhook_subscription_id: result.subscriptionId || null,
            updated_at: knex.fn.now(),
          });
        await new EmailWebhookMaintenanceService().recordWebhookDeliveryMode({
          providerId,
          tenant,
          reason: 'inbound pause resumed; webhook re-registered',
        });
      } else {
        await new GmailAdapter(adapterConfig).registerWebhookSubscription();
      }
      await db.table('email_providers').where({ id: providerId }).update({
        status: 'connected',
        error_message: null,
        updated_at: knex.fn.now(),
      });
      return { resumed: true, webhookRegistered: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.table('email_providers').where({ id: providerId }).update({
        status: 'error',
        error_message: message,
        updated_at: knex.fn.now(),
      });
      return { resumed: true, webhookRegistered: false, error: message };
    }
  }

  async deleteProvider(providerId: string, tenant: string): Promise<void> {
    const loaded = await this.loadProvider(providerId, tenant);
    if (!loaded) throw new Error('Provider not found');
    await this.teardownProviderSubscriptions(providerId, tenant);

    const knex = await getAdminConnection();
    const db = tenantDb(knex, tenant);
    const configTable = loaded.provider.provider_type === 'microsoft'
      ? 'microsoft_email_provider_config'
      : loaded.provider.provider_type === 'google'
        ? 'google_email_provider_config'
        : 'imap_email_provider_config';
    await db.table(configTable).where({ email_provider_id: providerId }).del();
    await db.table('email_providers').where({ id: providerId }).del();
  }
}
