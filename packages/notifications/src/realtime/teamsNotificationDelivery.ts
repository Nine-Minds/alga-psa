import logger from '@alga-psa/core/logger';
import { isEnterprise } from '@alga-psa/core/features';
import type { InternalNotification } from '../types/internalNotification';

/**
 * CE-safe delegator for Teams activity-feed notification delivery.
 *
 * The real implementation lives in @alga-psa/ee-microsoft-teams and records a
 * teams_notification_deliveries row for every attempt (skipped / delivered /
 * failed). This module holds NO delivery or classification logic of its own —
 * it resolves the edition seam (@alga-psa/ee-stubs maps to the EE re-export on
 * enterprise builds and to a skipping stub on CE) and forwards the call.
 */

type TeamsNotificationCategory =
  | 'assignment'
  | 'customer_reply'
  | 'approval_request'
  | 'escalation'
  | 'sla_risk';

export type TeamsNotificationDeliveryResult =
  | { status: 'skipped'; reason: string }
  | {
      status: 'delivered';
      category: TeamsNotificationCategory;
      providerMessageId: string | null;
    }
  | {
      status: 'failed';
      category?: TeamsNotificationCategory;
      errorCode: string;
      errorMessage: string;
      retryable: boolean;
    };

interface TeamsDeliverySeamModule {
  deliverTeamsNotificationImpl?: (
    notification: InternalNotification
  ) => Promise<TeamsNotificationDeliveryResult>;
}

let deliverySeamModulePromise: Promise<TeamsDeliverySeamModule> | null = null;

async function loadTeamsDeliverySeamModule(): Promise<TeamsDeliverySeamModule> {
  if (!deliverySeamModulePromise) {
    deliverySeamModulePromise = import('@alga-psa/ee-stubs/lib/notifications/teamsNotificationDelivery')
      .then((mod) => mod as TeamsDeliverySeamModule)
      .catch((error) => {
        logger.warn('[TeamsNotificationDelivery] Failed to load Teams delivery implementation', {
          error: error instanceof Error ? error.message : String(error),
        });
        return {} as TeamsDeliverySeamModule;
      });
  }

  return deliverySeamModulePromise;
}

export async function deliverTeamsNotification(
  notification: InternalNotification
): Promise<TeamsNotificationDeliveryResult> {
  if (!isEnterprise) {
    return { status: 'skipped', reason: 'ce_unavailable' };
  }

  const seam = await loadTeamsDeliverySeamModule();
  if (typeof seam.deliverTeamsNotificationImpl !== 'function') {
    return { status: 'skipped', reason: 'delivery_unavailable' };
  }

  return seam.deliverTeamsNotificationImpl(notification);
}
