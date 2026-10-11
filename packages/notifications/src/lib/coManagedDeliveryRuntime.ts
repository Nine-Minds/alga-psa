import { getConnection } from '@alga-psa/db';
import { publishAuthorizedInAppNotification } from '../realtime/internalNotificationBroadcaster';
import { deliverAuthorizedTeamsNotification } from '../realtime/teamsNotificationDelivery';
import type { NotificationDeliveryTransport, NotificationDeliveryChannel, NotificationDeliveryResult } from './notificationTransportTypes';
import type { InternalNotification } from '../types/internalNotification';
import { processCoManagedNotificationDeliveries } from './coManagedDeliveryQueue';

let pushTransport: NotificationDeliveryTransport | undefined;
/** The server owns its push SDK. Maintenance fanout and immediate delivery use
 * this same registered adapter; a missing adapter stays retryable. */
export function registerCoManagedPushTransport(transport: NotificationDeliveryTransport): () => void {
  const previous = pushTransport;
  pushTransport = transport;
  return () => { if (pushTransport === transport) pushTransport = previous; };
}

export async function deliverCoManagedNotificationChannel(channel: NotificationDeliveryChannel, notification: InternalNotification): Promise<NotificationDeliveryResult> {
  if (channel === 'in_app') return publishAuthorizedInAppNotification(notification);
  if (channel === 'teams') {
    const result = await deliverAuthorizedTeamsNotification(notification);
    return result.status === 'skipped' && result.reason === 'delivery_unavailable'
      ? { status: 'failed', errorCode: 'transport_unavailable', retryable: true } : result;
  }
  if (channel === 'push' && pushTransport) return pushTransport(notification);
  return { status: 'failed', errorCode: 'transport_unavailable', retryable: true };
}

export async function recoverCoManagedNotificationDeliveries(tenant: string, limit = 30, notificationId?: string) {
  return processCoManagedNotificationDeliveries(await getConnection(tenant), tenant, deliverCoManagedNotificationChannel, { limit, notificationId });
}
