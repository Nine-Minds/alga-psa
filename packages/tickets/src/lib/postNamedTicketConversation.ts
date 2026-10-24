import { namedConversationFileStorage } from './conversationFileStorage';
import { prepareNamedConversationPublicationFiles, postNamedTicketConversationDraft,
  type NamedConversationPostContext, type NamedConversationPostRequest, type CoManagedSessionActor, type CoManagedCommentInsert } from '@alga-psa/co-managed';
import type { Knex } from 'knex';
import type { ConversationTicketReference, TicketConversationReference } from '@alga-psa/shared/lib/tickets/namedConversations';
import { applyTicketConversationComment } from './applyTicketConversationComment';
import { assertNamedTicketConversationBundleTarget } from '@alga-psa/co-managed';
import { applyTicketBundleCommentEffects } from './ticketBundleCommentEffects';
import { closeNamedRequesterTicket } from './closeNamedRequesterTicket';

export async function postNamedTicketConversation(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference,
  reference: TicketConversationReference, request: NamedConversationPostRequest) {
  await prepareNamedConversationPublicationFiles(db, actor, ticket, reference, request, 'post', namedConversationFileStorage);
  return postNamedTicketConversationDraft(db, actor, ticket, reference, request, applyNamedTicketConversationPost);
}


export async function applyNamedTicketConversationPost(context: NamedConversationPostContext, comment: CoManagedCommentInsert) {
  await applyTicketConversationComment({ trx: context.trx, resource: { tenant: context.ticket.tenant, id: context.ticket.ticketId },
    actor: context.actor, actorReferenceId: context.actorReferenceId, audience: context.conversation.audience,
    conversationId: context.conversation.conversationId, assertWriteAuthority: context.assertWriteAuthority,
    canUpdateResponseState: context.canUpdateResponseState, publicationOptions: context.publicationOptions,
    publication: context.shared ? 'qualified' : 'native',
    externalDelivery: context.conversation.transport === 'email' ? 'reviewed_email' : 'notifications' }, comment);
  if (context.publicationOptions?.schedule) return;
  if (!context.shared && context.conversation.defaultSlot === 'requester') {
    await applyTicketBundleCommentEffects(context.trx, context.ticket.tenant, comment.comment_id, context.actor.userId,
      (ticketId, effect) => assertNamedTicketConversationBundleTarget(context.trx, context.actor,
        { tenant: context.ticket.tenant, ticketId }, effect));
    await context.assertWriteAuthority(context.trx);
  }
  await closeNamedRequesterTicket(context);
}
