'use server';

import { TicketConversationError, type TicketConversationReference } from '@alga-psa/shared/lib/tickets/namedConversations';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { getNamedTicketConversationMessages, getCoManagedTicketConversation, getCoManagedConversationContributionHints, type CoManagedSharedResource, type CoManagedConversationCursor } from '@alga-psa/co-managed';
import { coManagedAttachmentUploadLimit } from '../co-managed/attachmentUploadLimit';
import { coManagedBrowserActor } from '../co-managed/browserActor';

export const getCoManagedTicketConversationAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, before?: CoManagedConversationCursor) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  return getCoManagedTicketConversation(knex, actor, resource, before);
});

export const getCoManagedTicketConversationScreenAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, before?: CoManagedConversationCursor, requester?: TicketConversationReference) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  const { writeAudiences, attachmentAudiences } = await getCoManagedConversationContributionHints(knex, actor, resource);
  const maxBytes = coManagedAttachmentUploadLimit();
  const named = requester ? await getNamedTicketConversationMessages(knex, actor,
    { tenant: resource.tenant, ticketId: resource.id, relationshipId: resource.relationshipId }, requester, before) : null;
  if (named && (named.conversation.defaultSlot !== 'requester' || named.conversation.audience !== 'requester')) throw new TicketConversationError('CONVERSATION_FORBIDDEN');
  const conversation = named ? { resource, items: named.items, nextBefore: named.nextBefore } : await getCoManagedTicketConversation(knex, actor, resource, before);
  return { ...conversation, actor: { tenant: actor.tenant, userId: actor.userId }, writeAudiences: named ? writeAudiences.filter(a => a === 'requester') : writeAudiences,
    draftAttachments: { audiences: maxBytes > 0 ? attachmentAudiences.filter(a => !named || a === 'requester') : [], maxBytes, maxFiles: 20 } };
});
