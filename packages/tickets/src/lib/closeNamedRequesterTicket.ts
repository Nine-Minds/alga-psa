import { tenantDb } from '@alga-psa/db';
import { assertNamedTicketConversationBundleTarget, CoManagedSharedWorkError, type NamedConversationPostContext } from '@alga-psa/co-managed';
import type { IUserWithRoles } from '@alga-psa/types';
import { updateTicketInTransaction } from '../actions/optimizedTicketActions';

/** Runs after the resolution comment exists, in its publication transaction.
 * Existing close rules see that resolution; a blocked close rolls it all back. */
export async function closeNamedRequesterTicket(context: NamedConversationPostContext) {
  const close = context.publicationOptions?.close;
  if (!close) return;
  if (context.shared || context.conversation.audience !== 'requester' || context.actor.tenant !== context.ticket.tenant)
    throw new CoManagedSharedWorkError();
  const store = tenantDb(context.trx, context.ticket.tenant);
  await assertNamedTicketConversationBundleTarget(context.trx, context.actor, context.ticket, 'close');
  const settings = await store.table('ticket_bundle_settings').where('master_ticket_id', context.ticket.ticketId).forShare().first();
  if (settings?.mode === 'sync_updates') {
    const children = await store.table('tickets').where('master_ticket_id', context.ticket.ticketId).orderBy('ticket_id').forUpdate().select('ticket_id');
    for (const child of children) await assertNamedTicketConversationBundleTarget(context.trx, context.actor,
      { tenant: context.ticket.tenant, ticketId: child.ticket_id }, 'close');
  }
  const user = await store.table<IUserWithRoles>('users').where({ user_id: context.actor.userId, is_inactive: false, user_type: 'internal' }).first();
  if (!user) throw new CoManagedSharedWorkError();
  await updateTicketInTransaction(context.trx, user, context.ticket.tenant, context.ticket.ticketId, { status_id: close.statusId }, {
    // The reviewed message owns the explicit external delivery, including its
    // exact recipients. The close event still drives internal/workflow effects.
    suppressContactNotifications: true,
    ...(close.overrideReason !== undefined ? { overrideCloseRules: true, overrideCloseRulesReason: close.overrideReason } : {}),
  });
  await context.assertWriteAuthority(context.trx);
}
