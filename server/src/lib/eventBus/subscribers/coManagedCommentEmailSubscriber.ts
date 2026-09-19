import { EventSchemas, type BaseEvent } from '@alga-psa/event-schemas';
import { getConnection, registerAfterCommit, tenantDb } from '@alga-psa/db';
import { consumeCoManagedConversationEvent, enqueueCoManagedCommentEmailDeliveries, enqueueCoManagedTaskEmailDeliveries, processCoManagedCommentEmailDeliveries } from '@alga-psa/co-managed';
import { sendCoManagedCommentEmail } from '@alga-psa/jobs/handlers/coManagedCommentEmailTransport';
/** Independent subscriber: targeted recovery of MSP email discovery cannot
 * resend customer-native mail. Provider sends happen only after discovery commits. */
export async function handleCoManagedCommentEmailEvent(input: BaseEvent): Promise<void> {
  const event = EventSchemas.TICKET_COMMENT_ADDED.parse(input);
  const db = await getConnection(event.payload.tenantId);
  const persist = async (connection: typeof db, payload: typeof event.payload) => {
    if (payload.suppressInternalNotifications === true || !payload.comment) return;
    await enqueueCoManagedCommentEmailDeliveries(connection, { ownerTenant: payload.tenantId, ticketId: payload.ticketId,
      commentId: payload.comment!.id, eventId: event.id });
  };
  const handled = await consumeCoManagedConversationEvent(db, event as any, 'co-managed-email', async (trx, current) => {
    await persist(trx, current.payload as typeof event.payload);
    const relationship = await tenantDb(trx, event.payload.tenantId).table('co_management_relationships').where('state', 'active').whereNull('ended_at').first('sponsor_tenant');
    if (relationship) registerAfterCommit(trx, () => processCoManagedCommentEmailDeliveries(db, relationship.sponsor_tenant, sendCoManagedCommentEmail).then(() => {}), 'co-managed email delivery');
  });
  if (!handled) await persist(db, event.payload);
}

/** Task mail has no cached-payload fallback. The retained intent enrolls both
 * organizations atomically; each send uses its own current home mail settings. */
export async function handleCoManagedTaskCommentEmailEvent(input: BaseEvent): Promise<void> {
  const event = EventSchemas.PROJECT_TASK_COMMENT_CREATED.parse(input);
  const db = await getConnection(event.payload.tenantId);
  await consumeCoManagedConversationEvent(db, event as any, 'co-managed-email', async (trx, current) => {
    const payload = current.payload;
    await enqueueCoManagedTaskEmailDeliveries(trx, { ownerTenant: payload.tenantId as string, taskId: payload.taskId as string,
      commentId: payload.taskCommentId as string, eventId: event.id });
    const relationship = await tenantDb(trx, event.payload.tenantId).table('co_management_relationships').where('state', 'active').whereNull('ended_at').first('sponsor_tenant');
    for (const tenant of [...(relationship ? [relationship.sponsor_tenant] : []), event.payload.tenantId]) {
      registerAfterCommit(trx, () => processCoManagedCommentEmailDeliveries(db, tenant, sendCoManagedCommentEmail).then(() => {}), 'co-managed task email delivery');
    }
  });
}
