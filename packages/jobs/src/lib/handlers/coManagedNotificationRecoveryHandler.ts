import { getConnection } from '@alga-psa/db';
import { dispatchCoManagedConversationEvents } from '@alga-psa/co-managed';
import { publishCoManagedConversationEvent } from './coManagedConversationEventPublication';
import { recoverCoManagedNotificationDeliveries } from '@alga-psa/notifications/lib/coManagedDeliveryRuntime';
export const CO_MANAGED_NOTIFICATION_RECOVERY_JOB = 'co-managed-notification-recovery';
export async function coManagedNotificationRecoveryHandler(input: { tenantId: string; limit?: number }) {
  const events = await dispatchCoManagedConversationEvents(await getConnection(input.tenantId), input.tenantId, publishCoManagedConversationEvent, { limit: input.limit });
  return { events, notifications: await recoverCoManagedNotificationDeliveries(input.tenantId, input.limit) };
}
