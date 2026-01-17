import logger from '@alga-psa/core/logger';
import { runWithTenant } from 'server/src/lib/db';
import { CalendarWebhookMaintenanceService } from 'server/src/services/calendar/CalendarWebhookMaintenanceService';
import { GoogleCalendarAdapter } from 'server/src/services/calendar/providers/GoogleCalendarAdapter';
import { CalendarProviderService } from 'server/src/services/calendar/CalendarProviderService';

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
    const service = new CalendarWebhookMaintenanceService();
    const results = await service.renewMicrosoftWebhooks({
      tenantId,
      lookAheadMinutes
    });

    // Log summary
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    logger.info('[CalendarWebhookMaintenance] Microsoft webhook renewal completed', {
      tenantId,
      total: results.length,
      successful: successful.length,
      failed: failed.length,
      actions: {
        renewed: successful.filter(r => r.action === 'renewed').length,
        recreated: successful.filter(r => r.action === 'recreated').length,
        failed: failed.length
      }
    });

    // Log individual failures for debugging
    for (const result of failed) {
      logger.error('[CalendarWebhookMaintenance] Failed to renew Microsoft webhook', {
        tenantId,
        providerId: result.providerId,
        action: result.action,
        error: result.error
      });
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

      const adapter = new GoogleCalendarAdapter(fullProvider);
      try {
        await adapter.registerWebhookSubscription();
      } catch (error: any) {
        logger.error('[CalendarWebhookMaintenance] Failed to verify Google Calendar webhook subscription', {
          tenantId,
          providerId: provider.id,
          error: error?.message || error
        });
      }
    }
  });
}
