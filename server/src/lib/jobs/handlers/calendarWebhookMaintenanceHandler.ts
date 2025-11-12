import logger from '@shared/core/logger';
import { runWithTenant } from 'server/src/lib/db';
import { CalendarProviderService } from 'server/src/services/calendar/CalendarProviderService';
import { MicrosoftCalendarAdapter } from 'server/src/services/calendar/providers/MicrosoftCalendarAdapter';
import { GoogleCalendarAdapter } from 'server/src/services/calendar/providers/GoogleCalendarAdapter';

export interface MicrosoftWebhookRenewalJobData extends Record<string, unknown> {
  tenantId: string;
  lookAheadMinutes?: number;
}

export interface GooglePubSubVerificationJobData extends Record<string, unknown> {
  tenantId: string;
}

export async function renewMicrosoftCalendarWebhooks(
  data: MicrosoftWebhookRenewalJobData
): Promise<void> {
  const { tenantId, lookAheadMinutes = 180 } = data;

  await runWithTenant(tenantId, async () => {
    const providerService = new CalendarProviderService();
    const providers = await providerService.getProviders({
      tenant: tenantId,
      providerType: 'microsoft',
      isActive: true
    });

    for (const provider of providers) {
      const fullProvider = await providerService.getProvider(provider.id, tenantId, {
        includeSecrets: true
      });

      if (!fullProvider?.provider_config?.webhookExpiresAt) {
        continue;
      }

      const expiresAt = new Date(fullProvider.provider_config.webhookExpiresAt);
      if (Number.isNaN(expiresAt.getTime())) {
        continue;
      }

      const minutesUntilExpiry = (expiresAt.getTime() - Date.now()) / 60000;
      if (minutesUntilExpiry > lookAheadMinutes) {
        continue;
      }

      const adapter = new MicrosoftCalendarAdapter(fullProvider);
      try {
        await adapter.renewWebhookSubscription();
        logger.info('[CalendarWebhookMaintenance] Renewed Microsoft webhook subscription', {
          tenantId,
          providerId: provider.id,
          expiresAt: expiresAt.toISOString()
        });
      } catch (error: any) {
        logger.error('[CalendarWebhookMaintenance] Failed to renew Microsoft webhook', {
          tenantId,
          providerId: provider.id,
          error: error?.message || error
        });
      }
    }
  });
}

export async function verifyGoogleCalendarProvisioning(
  data: GooglePubSubVerificationJobData
): Promise<void> {
  const { tenantId } = data;

  await runWithTenant(tenantId, async () => {
    const providerService = new CalendarProviderService();
    const providers = await providerService.getProviders({
      tenant: tenantId,
      providerType: 'google',
      isActive: true
    });

    for (const provider of providers) {
      const fullProvider = await providerService.getProvider(provider.id, tenantId, {
        includeSecrets: true
      });

      if (!fullProvider?.provider_config) {
        continue;
      }

      const { pubsubSubscriptionName } = fullProvider.provider_config;
      if (!pubsubSubscriptionName) {
        logger.warn('[CalendarWebhookMaintenance] Google provider missing Pub/Sub subscription', {
          tenantId,
          providerId: provider.id,
          providerName: provider.name
        });
        continue;
      }

      const adapter = new GoogleCalendarAdapter(fullProvider);
      try {
        await adapter.registerWebhookSubscription();
      } catch (error: any) {
        logger.error('[CalendarWebhookMaintenance] Failed to verify Google Pub/Sub subscription', {
          tenantId,
          providerId: provider.id,
          error: error?.message || error
        });
      }
    }
  });
}
