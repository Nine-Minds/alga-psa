import { recoverNamedConversationNotifications } from '@alga-psa/notifications/lib/namedConversationNotificationFanout';
import { sendCoManagedWorkflowTicketEmail } from './coManagedWorkflowTicketEmailTransport';
import { recoverCoManagedScheduledComments } from './publishScheduledComment';
import { recoverNativeNamedConversationEmails, recoverNamedConversationEmailNotifications } from '@alga-psa/co-managed';
import { namedConversationEmailTransport } from '@alga-psa/tickets/lib/namedConversationEmail';
import { getConnection } from '@alga-psa/db';
import { dispatchCoManagedConversationEvents, recoverCoManagedEventConsumers, processCoManagedCommentEmailDeliveries, processCoManagedCustomerEmailDeliveries, processCoManagedRequesterEmailDeliveries, processCoManagedWorkflowTicketEmails } from '@alga-psa/co-managed';
import { sendCoManagedCommentEmail, sendCoManagedCustomerCommentEmail, sendCoManagedRequesterCommentEmail } from './coManagedCommentEmailTransport';
import { publishCoManagedConversationEvent, replayCoManagedConversationConsumer } from './coManagedConversationEventPublication';
import { recoverCoManagedNotificationDeliveries } from '@alga-psa/notifications/lib/coManagedDeliveryRuntime';
import { persistCoManagedRoutingNotifications } from '@alga-psa/notifications/lib/coManagedRoutingNotifications';
import { processCoManagedRoutingEmailDeliveries } from '@alga-psa/co-managed';
import { sendCoManagedRoutingEmail } from './coManagedRoutingEmailTransport';
export const CO_MANAGED_NOTIFICATION_RECOVERY_JOB = 'co-managed-notification-recovery';
export async function coManagedNotificationRecoveryHandler(input: { tenantId: string; limit?: number }) {
  const db = await getConnection(input.tenantId);
  const failures: unknown[] = [];
  // LEVERAGE: pattern independent-maintenance-recovery — a failed conversation stage must not starve committed workflow emails (also used by SLA maintenance).
  const recover = async <T>(work: () => Promise<T>): Promise<T | undefined> => {
    try { return await work(); } catch (error) { failures.push(error); }
  };
  const namedNotifications = await recover(() => recoverNamedConversationNotifications(db, input.tenantId, input.limit));
  const namedEmailNotifications = await recover(() => recoverNamedConversationEmailNotifications(db, input.tenantId, input.limit));
  const namedEmails = await recover(() => recoverNativeNamedConversationEmails(db, input.tenantId, namedConversationEmailTransport, input.limit));
  const schedules = await recover(() => recoverCoManagedScheduledComments(db, input.tenantId, input.limit));
  const events = await recover(() => dispatchCoManagedConversationEvents(db, input.tenantId, publishCoManagedConversationEvent, { limit: input.limit }));
  const consumers = await recover(() => recoverCoManagedEventConsumers(db, input.tenantId, replayCoManagedConversationConsumer, { limit: input.limit }));
  const emails = await recover(() => processCoManagedCommentEmailDeliveries(db, input.tenantId, sendCoManagedCommentEmail, { limit: input.limit }));
  const customerEmails = await recover(() => processCoManagedCustomerEmailDeliveries(db, input.tenantId, sendCoManagedCustomerCommentEmail, { limit: input.limit }));
  const requesterEmails = await recover(() => processCoManagedRequesterEmailDeliveries(db, input.tenantId, sendCoManagedRequesterCommentEmail, { limit: input.limit }));
  const workflowEmails = await recover(() => processCoManagedWorkflowTicketEmails(db, input.tenantId, sendCoManagedWorkflowTicketEmail, input.limit));
  const routingNotifications = await recover(() => persistCoManagedRoutingNotifications(db, input.tenantId, input.limit));
  const routingEmails = await recover(() => processCoManagedRoutingEmailDeliveries(db, input.tenantId, sendCoManagedRoutingEmail, input.limit));
  const notifications = await recover(() => recoverCoManagedNotificationDeliveries(input.tenantId, input.limit));
  if (failures.length) throw new AggregateError(failures, 'Co-managed notification maintenance has unfinished work');
  return { namedNotifications, namedEmailNotifications, namedEmails, workflowEmails, schedules, events, consumers, emails, customerEmails, requesterEmails, routingNotifications, routingEmails, notifications };
}
