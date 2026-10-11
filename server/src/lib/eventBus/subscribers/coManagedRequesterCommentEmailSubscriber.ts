import type { Knex } from 'knex';
import { EventSchemas, type BaseEvent } from '@alga-psa/event-schemas';
import { getConnection, registerAfterCommitWithConnection, tenantDb } from '@alga-psa/db';
import { consumeCoManagedConversationEvent, enqueueCoManagedRequesterEmailDelivery, enqueueCoManagedRequesterTaskEmailDeliveries, processCoManagedRequesterEmailDeliveries, isCoManagedUuid } from '@alga-psa/co-managed';
import { sendCoManagedRequesterCommentEmail } from '@alga-psa/jobs/handlers/coManagedCommentEmailTransport';

/** Targeted primary-requester discovery has no native requester side effects. */
export async function deliverCoManagedRequesterCommentEmailEvent(event: BaseEvent): Promise<void> {
  await handleCoManagedRequesterCommentEmailEvent(event);
}
/** Task requester mail is owned only by retained canonical intent. Replays
 * cannot fall back to cached task bodies or the native ticket mail path. */
export async function deliverCoManagedRequesterTaskCommentEmailEvent(event: BaseEvent): Promise<void> {
  await handleCoManagedRequesterTaskCommentEmailEvent(event);
}
export async function handleCoManagedRequesterTaskCommentEmailEvent(input: BaseEvent, connection?: Knex): Promise<boolean> {
  if (!isCoManagedUuid(input.id)) return false;
  const event = EventSchemas.PROJECT_TASK_COMMENT_CREATED.parse(input), db = connection ?? await getConnection(event.payload.tenantId);
  return consumeCoManagedConversationEvent(db, event as any, 'requester-email', async (trx, current) => {
    if (current.payload.collaboration?.audience !== 'requester') return;
    await enqueueCoManagedRequesterTaskEmailDeliveries(trx, { ownerTenant: current.payload.tenantId, taskId: current.payload.taskId,
      commentId: current.payload.taskCommentId, eventId: event.id });
    registerAfterCommitWithConnection(trx, root => processCoManagedRequesterEmailDeliveries(root, event.payload.tenantId, sendCoManagedRequesterCommentEmail).then(() => {}), 'task requester email delivery');
  });
}
/** Returns whether retained co-managed intent owns primary requester email completion.
 * Native events without that intent retain their existing delivery path. */
export async function handleCoManagedRequesterCommentEmailEvent(input: BaseEvent, connection?: Knex): Promise<boolean> {
  if (!isCoManagedUuid(input.id)) return false;
  const event = EventSchemas.TICKET_COMMENT_ADDED.parse(input);
  const db = connection ?? await getConnection(event.payload.tenantId);
  if (!await tenantDb(db, event.payload.tenantId).table('co_management_event_outbox').where('event_id', event.id).first('event_id')) return false;
  const obligation = await tenantDb(db, event.payload.tenantId).table('co_management_event_consumers')
    .where({ event_id: event.id, consumer: 'requester-email' }).first('status', 'error_code');
  if (obligation?.status === 'cancelled' && obligation.error_code === 'legacy_native_delivery') return false;
  return consumeCoManagedConversationEvent(db, event as any, 'requester-email', async (trx, current) => {
    const payload = current.payload as typeof event.payload;
    if (payload.suppressContactNotifications || !payload.comment) return;
    await enqueueCoManagedRequesterEmailDelivery(trx, { ownerTenant: payload.tenantId, ticketId: payload.ticketId, commentId: payload.comment.id, eventId: event.id });
    registerAfterCommitWithConnection(trx, root => processCoManagedRequesterEmailDeliveries(root, payload.tenantId, sendCoManagedRequesterCommentEmail).then(() => {}), 'primary requester email delivery');
  });
}
