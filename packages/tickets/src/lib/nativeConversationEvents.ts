import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { registerAfterCommit } from '@alga-psa/db';
import { retainCoManagedNativeCommentEvent } from '@alga-psa/co-managed/nativeConversationEvents';
import type { CoManagedEventPublication } from '@alga-psa/co-managed';
import { publishStoredEvent, publishWorkflowEvent, type WorkflowEventPublishContext, type PublishOptions, reviveStoredWorkflowPayload } from '@alga-psa/event-bus/publishers';
import { buildWorkflowPayload } from '@alga-psa/event-schemas';
// LEVERAGE: pattern retained-workflow-replay — tickets and jobs replay retained co-managed workflow publications the same way.
/** A retained workflow publication is a stored payload: revive it against the
 * catalogue schema before it goes back through the typed publisher. */
async function publishRetainedWorkflow(publication: CoManagedEventPublication, options?: PublishOptions) {
  // The retained payload is the builder's output; tenant, time and actor live in
  // the retained context, and the catalogue contract is checked on the stamped form.
  const stamped = buildWorkflowPayload(publication.payload as Record<string, unknown>, publication.workflowContext as WorkflowEventPublishContext);
  const revived = reviveStoredWorkflowPayload(publication.eventType, stamped);
  if (!revived) throw new Error(`${publication.eventType} is not a catalogued workflow event`);
  await publishWorkflowEvent({ eventType: revived.eventType, payload: revived.payload,
    ctx: publication.workflowContext as WorkflowEventPublishContext, idempotencyKey: publication.idempotencyKey } as Parameters<typeof publishWorkflowEvent>[0], options);
}


type Source = { tenant: string; ticketId: string; commentId: string };
const RETENTION_ERROR = 'co_managed_event_retention_failed';

async function publish(publication: CoManagedEventPublication, eventId: string) {
  if (publication.kind === 'workflow') await publishRetainedWorkflow(publication, { eventId, strict: true });
  else await publishStoredEvent({ eventType: publication.eventType, payload: publication.payload },
    { eventId, strict: true, ...(publication.channel ? { channel: publication.channel } : {}) });
}

/** Called in the admitted native write transaction. Retention failures must
 * escape legacy best-effort event catches and roll back the write. Ordinary PSA
 * publication remains best effort, but always runs after the owning commit. */
export async function retainNativeConversationEvent(trx: Knex.Transaction, source: Source, publication: CoManagedEventPublication,
  options: { eventId?: string; legacyPublish?: () => Promise<unknown>; precedesSourceRemoval?: boolean } = {}): Promise<boolean> {
  const eventId = options.eventId ?? randomUUID();
  try {
    const retained = await retainCoManagedNativeCommentEvent(trx, { ...source, eventId, publication,
      precedesSourceRemoval: options.precedesSourceRemoval === true }, publish);
    if (retained) return true;
  } catch (cause) {
    throw Object.assign(new Error('Could not retain the comment event with its mutation', { cause }), { code: RETENTION_ERROR });
  }
  registerAfterCommit(trx, async () => {
    if (options.legacyPublish) await options.legacyPublish();
    else if (publication.kind === 'workflow') await publishRetainedWorkflow(publication);
    else await publishStoredEvent({ eventType: publication.eventType, payload: publication.payload });
  },
    `${publication.eventType} ticket=${source.ticketId}`);
  return false;
}

export async function publishNativeCommentEvent(trx: Knex.Transaction, source: Source,
  event: Pick<CoManagedEventPublication, 'eventType' | 'payload'>, options: { precedesSourceRemoval?: boolean } = {}) {
  return retainNativeConversationEvent(trx, source, { ...event, kind: 'event' }, options);
}

export async function publishNativeCommentWorkflowEvent(trx: Knex.Transaction, source: Source,
  event: { eventType: CoManagedEventPublication['eventType']; payload: Record<string, any>; ctx: WorkflowEventPublishContext }) {
  return retainNativeConversationEvent(trx, source, { eventType: event.eventType, payload: event.payload, kind: 'workflow', workflowContext: event.ctx });
}

/** Qualified named posts retain the same outbox and dispatch semantics as the
 * existing shared writer, including foreign author references. */
export async function publishQualifiedNamedConversationEvent(trx: Knex.Transaction,
  source: Source & { threadId: string; audience: import('@alga-psa/shared/lib/commentAudience').CommentAudience },
  publication: CoManagedEventPublication, eventId: string) {
  const { enqueueCoManagedConversationEvent, dispatchCoManagedConversationEvents } = await import('@alga-psa/co-managed');
  const { registerAfterCommitWithConnection } = await import('@alga-psa/db');
  await enqueueCoManagedConversationEvent(trx, { ...source, eventId, publication });
  registerAfterCommitWithConnection(trx, root => dispatchCoManagedConversationEvents(root, source.tenant, publish, { eventId }).then(() => {}),
    `${publication.eventType} named conversation event=${eventId}`);
}
