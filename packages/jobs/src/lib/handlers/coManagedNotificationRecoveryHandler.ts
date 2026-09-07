import { recoverCoManagedScheduledComments } from './publishScheduledComment';
import { getConnection } from '@alga-psa/db';
import { dispatchCoManagedConversationEvents, recoverCoManagedEventConsumers, processCoManagedCommentEmailDeliveries, processCoManagedCustomerEmailDeliveries, processCoManagedRequesterEmailDeliveries } from '@alga-psa/co-managed';
import { sendCoManagedCommentEmail, sendCoManagedCustomerCommentEmail, sendCoManagedRequesterCommentEmail } from './coManagedCommentEmailTransport';
import { publishCoManagedConversationEvent, replayCoManagedConversationConsumer } from './coManagedConversationEventPublication';
import { recoverCoManagedNotificationDeliveries } from '@alga-psa/notifications/lib/coManagedDeliveryRuntime';
export const CO_MANAGED_NOTIFICATION_RECOVERY_JOB = 'co-managed-notification-recovery';
export async function coManagedNotificationRecoveryHandler(input: { tenantId: string; limit?: number }) {
  const db = await getConnection(input.tenantId);
  const schedules = await recoverCoManagedScheduledComments(db, input.tenantId, input.limit);
  const events = await dispatchCoManagedConversationEvents(db, input.tenantId, publishCoManagedConversationEvent, { limit: input.limit });
  const consumers = await recoverCoManagedEventConsumers(db, input.tenantId, replayCoManagedConversationConsumer, { limit: input.limit });
  const emails = await processCoManagedCommentEmailDeliveries(db, input.tenantId, sendCoManagedCommentEmail, { limit: input.limit });
  const customerEmails = await processCoManagedCustomerEmailDeliveries(db, input.tenantId, sendCoManagedCustomerCommentEmail, { limit: input.limit });
  const requesterEmails = await processCoManagedRequesterEmailDeliveries(db, input.tenantId, sendCoManagedRequesterCommentEmail, { limit: input.limit });
  return { schedules, events, consumers, emails, customerEmails, requesterEmails, notifications: await recoverCoManagedNotificationDeliveries(input.tenantId, input.limit) };
}
