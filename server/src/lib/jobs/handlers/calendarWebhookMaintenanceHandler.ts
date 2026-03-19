import logger from '@alga-psa/core/logger';

export interface MicrosoftWebhookRenewalJobData extends Record<string, unknown> {
  tenantId: string;
  lookAheadMinutes?: number;
}

export interface GooglePubSubVerificationJobData extends Record<string, unknown> {
  tenantId: string;
}

type EeCalendarWebhookMaintenanceModule = {
  renewMicrosoftCalendarWebhooks: (data: MicrosoftWebhookRenewalJobData) => Promise<void>;
  verifyGoogleCalendarProvisioning: (data: GooglePubSubVerificationJobData) => Promise<void>;
};

const isEnterpriseEdition =
  (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
  (process.env.EDITION ?? '').toLowerCase() === 'enterprise' ||
  (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise';

let eeCalendarWebhookMaintenanceModulePromise:
  | Promise<EeCalendarWebhookMaintenanceModule | null>
  | null = null;

async function loadEeCalendarWebhookMaintenanceModule(): Promise<EeCalendarWebhookMaintenanceModule | null> {
  if (!isEnterpriseEdition) {
    return null;
  }

  if (!eeCalendarWebhookMaintenanceModulePromise) {
    eeCalendarWebhookMaintenanceModulePromise = import('@alga-psa/ee-calendar/jobs')
      .then((mod) => {
        if (
          typeof mod?.renewMicrosoftCalendarWebhooks !== 'function' ||
          typeof mod?.verifyGoogleCalendarProvisioning !== 'function'
        ) {
          return null;
        }
        return mod as EeCalendarWebhookMaintenanceModule;
      })
      .catch((error) => {
        logger.error('[CalendarWebhookMaintenance] Failed to load EE maintenance module', { error });
        return null;
      });
  }

  return eeCalendarWebhookMaintenanceModulePromise;
}

export async function renewMicrosoftCalendarWebhooks(
  data: MicrosoftWebhookRenewalJobData
): Promise<void> {
  const eeModule = await loadEeCalendarWebhookMaintenanceModule();
  if (!eeModule?.renewMicrosoftCalendarWebhooks) {
    logger.info('[CalendarWebhookMaintenance] Skipping Microsoft renewal outside Enterprise Edition', {
      tenantId: data.tenantId,
    });
    return;
  }

  await eeModule.renewMicrosoftCalendarWebhooks(data);
}

export async function verifyGoogleCalendarProvisioning(
  data: GooglePubSubVerificationJobData
): Promise<void> {
  const eeModule = await loadEeCalendarWebhookMaintenanceModule();
  if (!eeModule?.verifyGoogleCalendarProvisioning) {
    logger.info('[CalendarWebhookMaintenance] Skipping Google Pub/Sub verification outside Enterprise Edition', {
      tenantId: data.tenantId,
    });
    return;
  }

  await eeModule.verifyGoogleCalendarProvisioning(data);
}
