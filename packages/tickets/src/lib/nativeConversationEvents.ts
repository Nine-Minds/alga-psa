import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { registerAfterCommit } from '@alga-psa/db';
import { retainCoManagedNativeCommentEvent } from '@alga-psa/co-managed/nativeConversationEvents';
import type { CoManagedEventPublication } from '@alga-psa/co-managed';
import { publishEvent, publishWorkflowEvent, type WorkflowEventPublishContext } from '@alga-psa/event-bus/publishers';

type Source = { tenant: string; ticketId: string; commentId: string };
const RETENTION_ERROR = 'co_managed_event_retention_failed';

async function publish(publication: CoManagedEventPublication, eventId: string) {
  if (publication.kind === 'workflow') await publishWorkflowEvent({ eventType: publication.eventType, payload: publication.payload,
    ctx: publication.workflowContext as WorkflowEventPublishContext, idempotencyKey: publication.idempotencyKey }, { eventId, strict: true });
  else await publishEvent({ eventType: publication.eventType, payload: publication.payload } as any,
    { eventId, strict: true, ...(publication.channel ? { channel: publication.channel } : {}) });
}

/** Called in the admitted native write transaction. Retention failures must
 * escape legacy best-effort event catches and roll back the write. Ordinary PSA
 * publication remains best effort, but always runs after the owning commit. */
export async function retainNativeConversationEvent(trx: Knex.Transaction, source: Source, publication: CoManagedEventPublication,
  options: { eventId?: string; legacyPublish?: () => Promise<unknown> } = {}): Promise<boolean> {
  const eventId = options.eventId ?? randomUUID();
  try {
    const retained = await retainCoManagedNativeCommentEvent(trx, { ...source, eventId, publication }, publish);
    if (retained) return true;
  } catch (cause) {
    throw Object.assign(new Error('Could not retain the comment event with its mutation', { cause }), { code: RETENTION_ERROR });
  }
  registerAfterCommit(trx, async () => {
    if (options.legacyPublish) await options.legacyPublish();
    else if (publication.kind === 'workflow') await publishWorkflowEvent({ eventType: publication.eventType, payload: publication.payload,
      ctx: publication.workflowContext as WorkflowEventPublishContext, idempotencyKey: publication.idempotencyKey });
    else await publishEvent({ eventType: publication.eventType, payload: publication.payload } as any);
  },
    `${publication.eventType} ticket=${source.ticketId}`);
  return false;
}

export async function publishNativeCommentEvent(trx: Knex.Transaction, source: Source,
  event: Pick<CoManagedEventPublication, 'eventType' | 'payload'>) {
  return retainNativeConversationEvent(trx, source, { ...event, kind: 'event' });
}

export async function publishNativeCommentWorkflowEvent(trx: Knex.Transaction, source: Source,
  event: { eventType: CoManagedEventPublication['eventType']; payload: Record<string, any>; ctx: WorkflowEventPublishContext }) {
  return retainNativeConversationEvent(trx, source, { eventType: event.eventType, payload: event.payload, kind: 'workflow', workflowContext: event.ctx });
}
