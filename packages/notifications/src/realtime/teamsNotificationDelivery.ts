import logger from '@alga-psa/core/logger';
import { getTeamsAvailability } from '@alga-psa/integrations/lib/teamsAvailability';
import type { InternalNotification } from '../types/internalNotification';

export type TeamsNotificationDeliveryResult =
  | { status: 'skipped'; reason: string }
  | { status: 'delivered'; category: 'assignment' | 'customer_reply' | 'approval_request' | 'escalation' | 'sla_risk'; providerMessageId: string | null }
  | { status: 'failed'; category?: 'assignment' | 'customer_reply' | 'approval_request' | 'escalation' | 'sla_risk'; errorCode: string; errorMessage: string; retryable: boolean };

let eeTeamsNotificationDeliveryPromise:
  | Promise<{
      deliverTeamsNotificationImpl?: (
        notification: InternalNotification
      ) => Promise<TeamsNotificationDeliveryResult>;
    }>
  | null = null;

async function loadEeTeamsNotificationDelivery() {
  if (!eeTeamsNotificationDeliveryPromise) {
    eeTeamsNotificationDeliveryPromise = import('@alga-psa/ee-microsoft-teams/lib/notifications/teamsNotificationDelivery').catch((error) => {
      logger.warn('[TeamsNotificationDelivery] Failed to load EE notification delivery implementation', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {};
    });
  }

  return eeTeamsNotificationDeliveryPromise;
}

export async function deliverTeamsNotification(
  notification: InternalNotification
): Promise<TeamsNotificationDeliveryResult> {
  const availability = await getTeamsAvailability({
    tenantId: notification.tenant,
    userId: notification.user_id,
  });
  if (!availability.enabled) {
    return { status: 'skipped', reason: availability.reason };
  }

  const ee = await loadEeTeamsNotificationDelivery();
  if (!ee?.deliverTeamsNotificationImpl) {
    return { status: 'skipped', reason: 'delivery_unavailable' };
  }

  return ee.deliverTeamsNotificationImpl(notification);
}
