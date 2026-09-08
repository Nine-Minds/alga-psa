import type { Knex } from 'knex';
import { createCoManagedTicketComment, type CoManagedCommentCreateRequest, type CoManagedSharedResource, type CoManagedSessionActor } from '@alga-psa/co-managed';
import { applyTicketConversationComment } from '@alga-psa/tickets/lib/applyTicketConversationComment';

/** Production admission and receipt wrap the canonical ticket comment writer. */
export async function createSharedTicketComment(db: Knex, actor: CoManagedSessionActor, resource: CoManagedSharedResource, request: CoManagedCommentCreateRequest) {
  return createCoManagedTicketComment(db, actor, resource, request, (context, comment) =>
    applyTicketConversationComment({ ...context, publication: 'qualified', externalDelivery: 'notifications' }, comment));
}
