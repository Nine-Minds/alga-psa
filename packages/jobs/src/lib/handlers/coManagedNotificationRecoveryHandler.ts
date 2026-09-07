import { getConnection } from '@alga-psa/db';
import { dispatchCoManagedConversationEvents, recoverCoManagedEventConsumers } from '@alga-psa/co-managed';
import { publishCoManagedConversationEvent, replayCoManagedConversationConsumer } from './coManagedConversationEventPublication';
import { recoverCoManagedNotificationDeliveries } from '@alga-psa/notifications/lib/coManagedDeliveryRuntime';
export const CO_MANAGED_NOTIFICATION_RECOVERY_JOB = 'co-managed-notification-recovery';
export async function coManagedNotificationRecoveryHandler(input: { tenantId: string; limit?: number }) {
  const db = await getConnection(input.tenantId);
  const events = await dispatchCoManagedConversationEvents(db, input.tenantId, publishCoManagedConversationEvent, { limit: input.limit });
  const consumers = await recoverCoManagedEventConsumers(db, input.tenantId, replayCoManagedConversationConsumer, { limit: input.limit });
  return { events, consumers, notifications: await recoverCoManagedNotificationDeliveries(input.tenantId, input.limit) };
}
