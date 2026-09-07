import type { CoManagedEventPublication, CoManagedEventConsumer } from '@alga-psa/co-managed';
import { getEmailEventChannel } from '@alga-psa/notifications';
import { publishEvent, publishWorkflowEvent, type WorkflowEventPublishContext } from '@alga-psa/event-bus/publishers';
/** Shared immediate/recovery transport. Strict mode must propagate partial
 * channel failures; every retry retains the producer's event/workflow identity. */
export async function publishCoManagedConversationEvent(publication: CoManagedEventPublication, eventId: string) {
  if (publication.kind === 'workflow') await publishWorkflowEvent({ eventType: publication.eventType, payload: publication.payload,
    ctx: publication.workflowContext as WorkflowEventPublishContext, idempotencyKey: publication.idempotencyKey }, { eventId, strict: true });
  else await publishEvent({ eventType: publication.eventType, payload: publication.payload } as any, { eventId, strict: true, ...(publication.channel ? { channel: publication.channel } : {}) });
}
export async function replayCoManagedConversationConsumer(publication: CoManagedEventPublication, eventId: string, consumer: CoManagedEventConsumer) {
  if (publication.kind !== 'event') throw new Error('Unsupported co-managed consumer publication');
  await publishEvent({ eventType: publication.eventType, payload: publication.payload } as any, {
    eventId, strict: true, force: true, targetSubscriber: consumer,
    channel: consumer === 'search-index' ? 'global' : ['co-managed-email', 'customer-internal-email', 'requester-email'].includes(consumer) ? getEmailEventChannel() : 'internal-notifications',
  });
}
