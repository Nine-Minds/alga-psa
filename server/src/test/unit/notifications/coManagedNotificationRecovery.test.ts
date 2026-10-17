import { beforeEach, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({ namedNotifications: vi.fn(), namedEmailNotifications: vi.fn(), namedEmails: vi.fn(), schedule: vi.fn(), events: vi.fn(), consumers: vi.fn(), emails: vi.fn(), customers: vi.fn(), requesters: vi.fn(), workflow: vi.fn(), notifications: vi.fn(), routing: vi.fn(), routingEmails: vi.fn() }));
vi.mock('@alga-psa/notifications/lib/namedConversationNotificationFanout', () => ({ recoverNamedConversationNotifications: runtime.namedNotifications }));
vi.mock('@alga-psa/tickets/lib/namedConversationEmail', () => ({ namedConversationEmailTransport: vi.fn() }));
vi.mock('@alga-psa/db', () => ({ getConnection: async () => 'db' }));
vi.mock('@alga-psa/co-managed', () => ({ recoverNativeNamedConversationEmails: runtime.namedEmails, recoverNamedConversationEmailNotifications: runtime.namedEmailNotifications, dispatchCoManagedConversationEvents: runtime.events, recoverCoManagedEventConsumers: runtime.consumers,
  processCoManagedCommentEmailDeliveries: runtime.emails, processCoManagedCustomerEmailDeliveries: runtime.customers,
  processCoManagedRequesterEmailDeliveries: runtime.requesters, processCoManagedWorkflowTicketEmails: runtime.workflow, processCoManagedRoutingEmailDeliveries: runtime.routingEmails }));
vi.mock('@alga-psa/jobs/handlers/publishScheduledComment', () => ({ recoverCoManagedScheduledComments: runtime.schedule }));
vi.mock('@alga-psa/jobs/handlers/coManagedCommentEmailTransport', () => ({ sendCoManagedCommentEmail: vi.fn(), sendCoManagedCustomerCommentEmail: vi.fn(), sendCoManagedRequesterCommentEmail: vi.fn() }));
vi.mock('@alga-psa/jobs/handlers/coManagedWorkflowTicketEmailTransport', () => ({ sendCoManagedWorkflowTicketEmail: vi.fn() }));
vi.mock('@alga-psa/jobs/handlers/coManagedConversationEventPublication', () => ({ publishCoManagedConversationEvent: vi.fn(), replayCoManagedConversationConsumer: vi.fn() }));
vi.mock('@alga-psa/notifications/lib/coManagedDeliveryRuntime', () => ({ recoverCoManagedNotificationDeliveries: runtime.notifications }));
vi.mock('@alga-psa/notifications/lib/coManagedRoutingNotifications', () => ({ persistCoManagedRoutingNotifications: runtime.routing }));
vi.mock('@alga-psa/jobs/handlers/coManagedRoutingEmailTransport', () => ({ sendCoManagedRoutingEmail: vi.fn() }));
import { coManagedNotificationRecoveryHandler } from '@alga-psa/jobs/handlers/coManagedNotificationRecoveryHandler';
beforeEach(() => { for (const fn of Object.values(runtime)) fn.mockReset().mockResolvedValue({ processed: 1 }); });
it.each(['namedNotifications', 'namedEmailNotifications', 'namedEmails', 'events', 'workflow', 'routing', 'routingEmails'] as const)('recovers independent committed work after %s fails and reports the remaining failure', async stage => {
  const failure = new Error('Stage unavailable'); runtime[stage].mockRejectedValue(failure);
  await expect(coManagedNotificationRecoveryHandler({ tenantId: 'customer', limit: 12 })).rejects.toMatchObject({ errors: [failure] });
  for (const fn of Object.values(runtime)) expect(fn).toHaveBeenCalledTimes(1);
  expect(runtime.workflow).toHaveBeenCalledWith('db', 'customer', expect.any(Function), 12);
});
