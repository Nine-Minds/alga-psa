import type { Knex } from 'knex';
import { registerAfterCommitWithConnection } from '@alga-psa/db';
import { enqueueCoManagedConversationEvent, dispatchCoManagedConversationEvents, type CoManagedEventIntent } from '@alga-psa/co-managed';
import type { CoManagedEventPublication, CoManagedEventConsumer } from '@alga-psa/co-managed';
import { getEmailEventChannel } from '@alga-psa/notifications';
import { publishStoredEvent, publishWorkflowEvent, type WorkflowEventPublishContext, type PublishOptions, reviveStoredWorkflowPayload } from '@alga-psa/event-bus/publishers';
// LEVERAGE: pattern retained-workflow-replay — tickets and jobs replay retained co-managed workflow publications the same way.
/** A retained workflow publication is a stored payload: revive it against the
 * catalogue schema before it goes back through the typed publisher. */
async function publishRetainedWorkflow(publication: CoManagedEventPublication, options?: PublishOptions) {
  const revived = reviveStoredWorkflowPayload(publication.eventType, publication.payload as Record<string, unknown>);
  if (!revived) throw new Error(`${publication.eventType} is not a catalogued workflow event`);
  await publishWorkflowEvent({ eventType: revived.eventType, payload: revived.payload,
    ctx: publication.workflowContext as WorkflowEventPublishContext, idempotencyKey: publication.idempotencyKey } as Parameters<typeof publishWorkflowEvent>[0], options);
}

/** Shared immediate/recovery transport. Strict mode must propagate partial
 * channel failures; every retry retains the producer's event/workflow identity. */
export async function publishCoManagedConversationEvent(publication: CoManagedEventPublication, eventId: string) {
  if (publication.kind === 'workflow') await publishRetainedWorkflow(publication, { eventId, strict: true });
  else await publishStoredEvent({ eventType: publication.eventType, payload: publication.payload }, { eventId, strict: true, ...(publication.channel ? { channel: publication.channel } : {}) });
}
export async function replayCoManagedConversationConsumer(publication: CoManagedEventPublication, eventId: string, consumer: CoManagedEventConsumer) {
  if (publication.kind !== 'event') throw new Error('Unsupported co-managed consumer publication');
  await publishStoredEvent({ eventType: publication.eventType, payload: publication.payload }, {
    eventId, strict: true, force: true, targetSubscriber: consumer,
    channel: consumer === 'search-index' ? 'global' : ['co-managed-email', 'customer-internal-email', 'requester-email'].includes(consumer) ? getEmailEventChannel() : 'internal-notifications',
  });
}

/** Retain intent with its writer; immediate transport is only an optimization. */
export async function queueCoManagedConversationEvent(trx: Knex.Transaction, input: CoManagedEventIntent) {
  await enqueueCoManagedConversationEvent(trx, input);
  const tenant = input.tenant, eventId = input.eventId;
  registerAfterCommitWithConnection(trx, root => dispatchCoManagedConversationEvents(root, tenant, publishCoManagedConversationEvent, { eventId }).then(() => {}),
    `${input.publication.eventType} durable event=${eventId}`);
}
