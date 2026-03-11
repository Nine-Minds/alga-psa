import logger from '@alga-psa/core/logger';
import { isEnterpriseEdition } from '@/lib/features';

type CalendarSyncSubscriberModule = {
  registerCalendarSyncSubscriber?: () => Promise<void>;
  unregisterCalendarSyncSubscriber?: () => Promise<void>;
};

let eeCalendarSyncSubscriberPromise: Promise<CalendarSyncSubscriberModule> | null = null;

async function loadEeCalendarSyncSubscriber(): Promise<CalendarSyncSubscriberModule> {
  if (!eeCalendarSyncSubscriberPromise) {
    eeCalendarSyncSubscriberPromise = import('@alga-psa/ee-calendar/event-bus')
      .then((mod) => mod as CalendarSyncSubscriberModule)
      .catch((error) => {
        logger.warn('[CalendarSyncSubscriber] Failed to load EE calendar subscriber implementation', {
          error: error instanceof Error ? error.message : String(error),
        });
        return {} as CalendarSyncSubscriberModule;
      });
  }

  return eeCalendarSyncSubscriberPromise;
}

export async function registerCalendarSyncSubscriber(): Promise<void> {
  if (!isEnterpriseEdition()) {
    logger.info('[CalendarSyncSubscriber] Skipping registration because calendar sync is enterprise-only');
    return;
  }

  const ee = await loadEeCalendarSyncSubscriber();
  await ee.registerCalendarSyncSubscriber?.();
}

export async function unregisterCalendarSyncSubscriber(): Promise<void> {
  if (!isEnterpriseEdition()) {
    return;
  }

  const ee = await loadEeCalendarSyncSubscriber();
  await ee.unregisterCalendarSyncSubscriber?.();
}
